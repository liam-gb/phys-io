
import os
import json
import time
import requests
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Import shared utilities
try:
    from utils import setup_logging, load_config, save_json, ensure_dir, display_config, confirm_run
except ImportError:
    # When run from project root
    from tests.evaluation.utils import setup_logging, load_config, save_json, ensure_dir, display_config, confirm_run


# Set up logging
logger = setup_logging("pipeline.log")

class Config:
    """Pipeline configuration"""
    
    def __init__(self, config_file: str):
        # Define required fields and defaults
        required = ['model', 'data_file', 'prompt_file']
        defaults = {
            'run_id': f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            'endpoint': "http://localhost:11434",
            'timeout': 1800,  # 30 minutes default
            'results_dir': "results"
        }
        
        # Load config using shared utility
        self.config = load_config(config_file, required, defaults)
    
    def __getattr__(self, name):
        if name in self.config:
            return self.config[name]
        raise AttributeError(f"no config attribute '{name}'")
    
    def save(self, path: str):
        save_json(self.config, path)
            
    def display(self):
        """print config nicely for console"""
        display_config(self.config)


class Pipeline:
    """Test pipeline for physio reports"""
    
    def __init__(self, config: Config, load_data=True, run_generation=True):
        self.config = config
        self.results_dir = Path(config.results_dir) / config.run_id
        self.test_data = None
        self.prompt = None
        self.results = []
        
        # Flags for which modules to run
        self.load_data = load_data
        self.run_generation = run_generation
    
    def setup(self):
        """Set up directories and log start"""
        ensure_dir(self.results_dir)
        
        # Save config
        self.config.save(self.results_dir / "config.json")
        
        # Log start time
        logger.info(f"Starting run {self.config.run_id} at {datetime.now().isoformat()}")
        logger.info(f"Using model: {self.config.model}")
        
        return self
    
    def execute(self):
        """Run the pipeline"""
        if self.load_data:
            self._load_data()
            self._load_prompt()
        
        if self.run_generation:
            self._run_generation()
        
        self._generate_summary()
        return self
    
    def _load_data(self):
        """Load test data"""
        with open(self.config.data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Ensure we have a list
        self.test_data = data if isinstance(data, list) else [data]
        
        # Save data info
        data_info = {
            "data_file": self.config.data_file,
            "num_cases": len(self.test_data),
            "case_ids": [case.get('id') for case in self.test_data if 'id' in case]
        }
        with open(self.results_dir / "data_info.json", 'w') as f:
            json.dump(data_info, f, indent=2)
            
        logger.info(f"loaded {len(self.test_data)} test cases")
    
    def _load_prompt(self):
        """Load prompt template"""
        with open(self.config.prompt_file, 'r', encoding='utf-8') as f:
            self.prompt = f.read()
        
        # Save a copy
        with open(self.results_dir / "prompt.txt", 'w', encoding='utf-8') as f:
            f.write(self.prompt)
    
    def _run_generation(self):
        """Generate reports for all test cases"""
        if not self.test_data or not self.prompt:
            logger.error("missing test data or prompt")
            return
        
        for i, case in enumerate(self.test_data):
            # Skip if missing id or notes
            if 'id' not in case:
                logger.warning(f"skipping case at index {i}: no ID")
                continue
                
            if 'notes' not in case or not case['notes']:
                logger.warning(f"skipping case {case['id']}: no notes")
                continue
            
            logger.info(f"processing case {i+1}/{len(self.test_data)}: {case['id']}")
            
            # Generate report
            result = self._generate_report(case['notes'])
            
            # Add to results
            result_entry = {
                "run_id": self.config.run_id,
                "test_id": case['id'],
                **result
            }
            self.results.append(result_entry)
            
            # Save result
            with open(self.results_dir / f"{case['id']}.json", 'w') as f:
                json.dump(result_entry, f, indent=2)
            
            # Save output text
            with open(self.results_dir / f"{case['id']}_output.txt", 'w') as f:
                f.write(result['output'])
        
        logger.info(f"completed generation for {len(self.results)} cases")
    
    def _generate_report(self, notes: str) -> Dict:
        """Call Ollama API to generate a report"""
        start_time = time.time()
        status = "success"
        output = ""
        error = None
        
        try:
            # Prepare request
            prompt = self.prompt.replace("{{notes}}", notes)
            payload = {
                "model": self.config.model,
                "prompt": prompt,
                "stream": False
            }
            
            # Make request
            response = requests.post(
                f"{self.config.endpoint}/api/generate",
                json=payload,
                timeout=self.config.timeout
            )
            
            if response.status_code == 200:
                result = response.json()
                output = result.get("response", "")
            else:
                status = "error"
                error = f"API error: {response.status_code} - {response.text}"
                logger.error(error)
                
        except Exception as e:
            status = "error"
            error = str(e)
            logger.error(f"generation error: {e}")
        
        end_time = time.time()
        
        return {
            "output": output,
            "status": status,
            "error": error,
            "start_time": start_time,
            "end_time": end_time,
            "runtime": end_time - start_time
        }
    
    def _generate_summary(self):
        """Generate summary of results"""
        if not self.results:
            logger.error("no results for summary")
            return
        
        # Basic metrics
        successful = sum(1 for r in self.results if r['status'] == 'success')
        failed = len(self.results) - successful
        run_success = failed == 0
        
        # Runtime stats
        runtimes = [r['runtime'] for r in self.results]
        avg_runtime = sum(runtimes) / len(runtimes) if runtimes else 0
        max_runtime = max(runtimes) if runtimes else 0
        min_runtime = min(runtimes) if runtimes else 0
        
        summary = {
            "run_id": self.config.run_id,
            "timestamp": datetime.now().isoformat(),
            "model": self.config.model,
            "git_commit": self._get_git_commit(),
            "total_cases": len(self.results),
            "run_success": run_success,
            "successful_cases": successful,
            "failed_cases": failed,
            "runtime_stats": {
                "avg_runtime": avg_runtime,
                "max_runtime": max_runtime,
                "min_runtime": min_runtime
            }
        }
        
        # Save summary
        with open(self.results_dir / "summary.json", 'w') as f:
            json.dump(summary, f, indent=2)
        
        # Log completion
        logger.info(f"run completed at {datetime.now().isoformat()}")
        logger.info(f"results in {self.results_dir}/")
        logger.info(f"status: {'SUCCESS' if run_success else 'FAILED'}")
        logger.info(f"cases: {successful} succeeded, {failed} failed")
        logger.info(f"runtime: avg={avg_runtime:.2f}s, min={min_runtime:.2f}s, max={max_runtime:.2f}s")
    
    def _get_git_commit(self):
        """Get current git commit hash"""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except:
            pass
        return "unknown"


def confirm_run(config):
    """Get user confirmation to proceed with run"""
    config.display()
    
    while True:
        response = input("proceed with this configuration? (y/n): ").strip().lower()
        if response == 'y':
            return True
        elif response == 'n':
            return False
        print("please enter 'y' or 'n'")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Physio report testing pipeline")
    parser.add_argument("--config", default="test/config.json", help="Config file (default: test/config.json)")
    parser.add_argument("--skip-data", action="store_true", help="Skip loading data/prompt")
    parser.add_argument("--skip-gen", action="store_true", help="Skip generation")
    parser.add_argument("--no-confirm", action="store_true", help="Skip confirmation prompt")
    
    args = parser.parse_args()
    
    try:
        # Load config
        config = Config(args.config)
        
        # Get confirmation unless --no-confirm
        if not args.no_confirm and not confirm_run(config):
            print("run cancelled")
            return 0
            
        # Create and run pipeline
        pipeline = Pipeline(
            config, 
            load_data=not args.skip_data,
            run_generation=not args.skip_gen
        ).setup()
        
        pipeline.execute()
        
    except Exception as e:
        logger.error(f"pipeline error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 1
        
    return 0

if __name__ == "__main__":
    exit(main())