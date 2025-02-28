#!/usr/bin/env python3

import os
import json
import time
import requests
import argparse
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Import shared utilities
try:
    from utils import setup_logging, load_config, save_json, ensure_dir, display_config, confirm_run
except ImportError:
    # When run from project root
    from test.utils import setup_logging, load_config, save_json, ensure_dir, display_config, confirm_run

# Set up logging
logger = setup_logging("eval.log")

class EvalConfig:
    """Evaluation configuration"""
    
    def __init__(self, config_file: str):
        # Define required fields and defaults
        required = ['model', 'data_file', 'prompt_file', 'run_id']
        defaults = {
            'eval_id': f"eval_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            'endpoint': "http://localhost:11434",
            'timeout': 1800,  # 30 minutes default
            'results_dir': "results",
            'weights': {
                "completeness": 0.25,
                "accuracy": 0.30, 
                "no_hallucinations": 0.20,
                "clinical_safety": 0.20,
                "coherence": 0.05
            }
        }
        
        # Load config using shared utility
        self.config = load_config(config_file, required, defaults)
    
    def __getattr__(self, name):
        if name in self.config:
            return self.config[name]
        raise AttributeError(f"No config attribute '{name}'")
    
    def save(self, path: str):
        save_json(self.config, path)
            
    def display(self):
        """Print config nicely for console"""
        display_config(self.config)


class Evaluator:
    """Evaluation pipeline for physio reports"""
    
    def __init__(self, config: EvalConfig):
        self.config = config
        self.data = None
        self.prompt = None
        self.generated_letters = {}
        self.eval_results = {}
        self.eval_dir = Path("eval_results") / config.eval_id
    
    def setup(self):
        """Set up directories and log start"""
        self.eval_dir.mkdir(parents=True, exist_ok=True)
        
        # Save config
        self.config.save(self.eval_dir / "eval_config.json")
        
        # Log start time
        logger.info(f"Starting evaluation {self.config.eval_id} at {datetime.now().isoformat()}")
        logger.info(f"Using model: {self.config.model}")
        logger.info(f"Evaluating run: {self.config.run_id}")
        
        return self
    
    def execute(self):
        """Run the evaluation pipeline"""
        self._load_data()
        self._load_prompt()
        self._load_generated_letters()
        self._run_evaluation()
        self._generate_summary()
        return self
    
    def _load_data(self):
        """Load test data with ground truth"""
        with open(self.config.data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Ensure we have a list
        self.data = data if isinstance(data, list) else [data]
        
        # Save data info
        data_info = {
            "data_file": self.config.data_file,
            "num_cases": len(self.data),
            "case_ids": [case.get('id') for case in self.data if 'id' in case]
        }
        with open(self.eval_dir / "data_info.json", 'w') as f:
            json.dump(data_info, f, indent=2)
            
        logger.info(f"Loaded {len(self.data)} test cases")
    
    def _load_prompt(self):
        """Load evaluation prompt template"""
        with open(self.config.prompt_file, 'r', encoding='utf-8') as f:
            self.prompt = f.read()
        
        # Save a copy
        with open(self.eval_dir / "eval_prompt.txt", 'w', encoding='utf-8') as f:
            f.write(self.prompt)
    
    def _load_generated_letters(self):
        """Load generated letters from the specified run"""
        run_dir = Path(self.config.results_dir) / self.config.run_id
        
        if not run_dir.exists():
            raise FileNotFoundError(f"Run directory not found: {run_dir}")
        
        # Find all output files
        output_files = list(run_dir.glob("*_output.txt"))
        
        if not output_files:
            raise FileNotFoundError(f"No output files found in {run_dir}")
        
        # Load each letter
        for output_file in output_files:
            patient_id = output_file.name.split("_output.txt")[0]
            with open(output_file, 'r', encoding='utf-8') as f:
                letter_content = f.read()
            
            self.generated_letters[patient_id] = letter_content
        
        logger.info(f"Loaded {len(self.generated_letters)} generated letters from {run_dir}")
    
    def _run_evaluation(self):
        """Run evaluation for each patient"""
        if not self.data or not self.prompt or not self.generated_letters:
            logger.error("Missing data, prompt, or generated letters")
            return
        
        for case in self.data:
            # Skip if missing id or notes
            if 'id' not in case:
                logger.warning(f"Skipping case: no ID")
                continue
                
            if 'id' not in case or 'notes' not in case or 'reference' not in case:
                logger.warning(f"Skipping case {case.get('id', 'unknown')}: missing required fields")
                continue
            
            if case['id'] not in self.generated_letters:
                logger.warning(f"Skipping case {case['id']}: no generated letter found")
                continue
            
            logger.info(f"Evaluating case: {case['id']}")
            
            # Run evaluation
            result = self._evaluate_case(
                case['id'],
                case['notes'],
                case['reference'],
                self.generated_letters[case['id']]
            )
            
            # Add to results
            self.eval_results[case['id']] = result
            
            # Save result
            with open(self.eval_dir / f"{case['id']}_eval.json", 'w') as f:
                json.dump(result, f, indent=2)
            
            # Save output text
            with open(self.eval_dir / f"{case['id']}_evaluation.txt", 'w') as f:
                f.write(result['evaluation'])
        
        logger.info(f"Completed evaluation for {len(self.eval_results)} cases")
    
    def _evaluate_case(self, case_id: str, notes: str, ground_truth: str, generated: str) -> Dict:
        """Call Ollama API to evaluate a generated letter"""
        start_time = time.time()
        status = "success"
        evaluation = ""
        error = None
        
        try:
            # Prepare request
            eval_prompt = self._prepare_eval_prompt(notes, ground_truth, generated)
            payload = {
                "model": self.config.model,
                "prompt": eval_prompt,
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
                evaluation = result.get("response", "")
                metrics = self._extract_metrics(evaluation)
            else:
                status = "error"
                error = f"API error: {response.status_code} - {response.text}"
                logger.error(error)
                metrics = {}
                
        except Exception as e:
            status = "error"
            error = str(e)
            logger.error(f"Evaluation error: {e}")
            metrics = {}
        
        end_time = time.time()
        
        return {
            "case_id": case_id,
            "status": status,
            "evaluation": evaluation,
            "metrics": metrics,
            "error": error,
            "start_time": start_time,
            "end_time": end_time,
            "runtime": end_time - start_time
        }
    
    def _prepare_eval_prompt(self, notes: str, ground_truth: str, generated: str) -> str:
        """Prepare the evaluation prompt for a specific case"""
        # Clean up generated letter to remove any <think> blocks
        if "<think>" in generated and "</think>" in generated:
            parts = generated.split("</think>")
            if len(parts) > 1:
                generated = parts[1].strip()
        
        # Enhance the prompt with specific instructions to follow the format exactly
        return f"""
{self.prompt}

## Original Clinical Notes
```
{notes}
```

## Ground Truth Letter (Written by Human Physiotherapist)
```
{ground_truth}
```

## Generated Letter
```
{generated}
```

VERY IMPORTANT: You MUST rate each dimension on a scale of 1-5 and follow the EXACT output format specified earlier.
You MUST rate each dimension separately and provide a weighted overall score.

Your response MUST begin with "### Patient Evaluation" and include NUMERICAL RATINGS for each dimension.
For example, your ratings must look like this:
**Completeness:** 4 / 5
**Accuracy:** 3.5 / 5
**No Hallucinations:** 4 / 5
**Clinical Safety:** 5 / 5
**Coherence:** 3 / 5
**Weighted Overall Score:** 3.9 / 5

DO NOT substitute numerical ratings with qualitative terms like "excellent" or "good".
Always use the format "X / 5" where X is a number between 1 and 5.
"""
    
    def _extract_metrics(self, evaluation_text: str) -> Dict:
        """Extract metrics from evaluation text using patterns that match the exact format seen in outputs"""
        import re
        
        metrics = {
            "completeness": 0,
            "accuracy": 0,
            "no_hallucinations": 0,
            "clinical_safety": 0,
            "coherence": 0,
            "weighted_score": 0
        }
        
        try:
            # Clean up evaluation text - remove any <think> blocks
            if "<think>" in evaluation_text and "</think>" in evaluation_text:
                parts = evaluation_text.split("</think>")
                if len(parts) > 1:
                    evaluation_text = parts[1].strip()
            
            # Simple patterns that exactly match the format we've observed
            patterns = {
                "completeness": r"\*\*Completeness:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5",
                "accuracy": r"\*\*Accuracy:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5",
                "no_hallucinations": r"\*\*No Hallucinations:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5",
                "clinical_safety": r"\*\*Clinical Safety:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5",
                "coherence": r"\*\*Coherence:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5",
                "weighted_score": r"\*\*Weighted Overall Score:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5"
            }
            
            # Extract each metric
            for metric, pattern in patterns.items():
                match = re.search(pattern, evaluation_text)
                if match:
                    metrics[metric] = float(match.group(1))
            
            # Calculate weighted score if not provided but we have other metrics
            if metrics["weighted_score"] == 0 and any(metrics[m] > 0 for m in metrics if m != "weighted_score"):
                weights = self.config.weights
                metrics["weighted_score"] = sum(
                    metrics[metric] * weights[metric] 
                    for metric in weights 
                    if metric in metrics
                )
            
        except Exception as e:
            logger.error(f"Error extracting metrics: {e}")
            import traceback
            logger.error(traceback.format_exc())
        
        return metrics
    
    def _generate_improvement_analysis(self):
        """Generate an analysis of where improvements are needed using a separate prompt"""
        try:
            # Load the summary prompt from the config
            summary_prompt_path = self.config.summary_prompt_file
            logger.info(f"Loading summary prompt from: {summary_prompt_path}")
            with open(summary_prompt_path, 'r', encoding='utf-8') as f:
                summary_prompt = f.read()
            
            # Read the evaluation output files for each case
            evaluation_texts = []
            
            for case_id in self.eval_results:
                eval_file_path = self.eval_dir / f"{case_id}_evaluation.txt"
                if eval_file_path.exists():
                    with open(eval_file_path, 'r', encoding='utf-8') as f:
                        evaluation_text = f.read()
                        # Keep the full text including <think> blocks for more detailed analysis
                        evaluation_texts.append(f"--- CASE {case_id} ---\n{evaluation_text}")
            
            # Combine the prompt and evaluations
            full_prompt = f"{summary_prompt}\n\n### EVALUATIONS:\n\n{chr(10).join(evaluation_texts)}"
            
            # Make request for the improvement analysis
            payload = {
                "model": self.config.model,
                "prompt": full_prompt,
                "stream": False
            }
            
            logger.info("Generating improvement analysis from evaluation results...")
            response = requests.post(
                f"{self.config.endpoint}/api/generate",
                json=payload,
                timeout=self.config.timeout
            )
            
            if response.status_code == 200:
                result = response.json()
                analysis = result.get("response", "")
                
                # Log the result size
                logger.info(f"Received improvement analysis ({len(analysis)} chars)")
                
                # Debug the response if empty
                if not analysis:
                    logger.error("Empty improvement analysis response from API")
                    logger.error(f"API response: {result}")
                
                return analysis
            else:
                logger.error(f"Error status code: {response.status_code}")
                return "Error generating improvement analysis."
                
        except Exception as e:
            logger.error(f"Error in improvement analysis: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return "Error generating improvement analysis."
    
    def _generate_summary(self):
        """Generate summary of evaluation results"""
        if not self.eval_results:
            logger.error("No results for summary")
            return
        
        # Compile metrics across cases
        all_metrics = {}
        for case_id, result in self.eval_results.items():
            all_metrics[case_id] = result.get('metrics', {})
        
        # Calculate averages
        avg_metrics = {
            "completeness": 0,
            "accuracy": 0,
            "no_hallucinations": 0,
            "clinical_safety": 0,
            "coherence": 0,
            "weighted_score": 0
        }
        
        for metrics in all_metrics.values():
            for key in avg_metrics.keys():
                avg_metrics[key] += metrics.get(key, 0)
        
        case_count = len(all_metrics)
        if case_count > 0:
            for key in avg_metrics:
                avg_metrics[key] /= case_count
        
        # Generate improvement analysis
        improvement_analysis = self._generate_improvement_analysis()
        
        # Compile summary
        summary = {
            "eval_id": self.config.eval_id,
            "run_id": self.config.run_id,
            "timestamp": datetime.now().isoformat(),
            "model": self.config.model,
            "cases_evaluated": list(self.eval_results.keys()),
            "average_metrics": avg_metrics,
            "case_metrics": all_metrics,
            "improvement_analysis": improvement_analysis
        }
        
        # Save summary
        with open(self.eval_dir / "eval_summary.json", 'w') as f:
            json.dump(summary, f, indent=2)
        
        # Create readable report
        report = self._generate_readable_report(summary)
        with open(self.eval_dir / "evaluation_report.md", 'w') as f:
            f.write(report)
        
        # Log completion and print improvement analysis
        logger.info(f"Evaluation completed at {datetime.now().isoformat()}")
        logger.info(f"Results in {self.eval_dir}/")
        logger.info(f"Average weighted score: {avg_metrics['weighted_score']:.2f}/5")
        
        # Print improvement analysis to terminal
        print("\n" + "="*50)
        print("IMPROVEMENT RECOMMENDATIONS:")
        print("="*50)
        if improvement_analysis:
            print(improvement_analysis)
        else:
            print("No improvement analysis was generated.")
        print("="*50)
    
    def _generate_readable_report(self, summary: Dict) -> str:
        """Generate a readable evaluation report"""
        avg = summary["average_metrics"]
        cases = summary["case_metrics"]
        improvement_analysis = summary.get("improvement_analysis", "No improvement analysis available.")
        
        report = f"""# Physiotherapy Report Evaluation

## Summary
- **Evaluation ID:** {summary["eval_id"]}
- **Run ID:** {summary["run_id"]}
- **Model:** {summary["model"]}
- **Date:** {summary["timestamp"].split("T")[0]}
- **Cases Evaluated:** {len(summary["cases_evaluated"])}

## Average Metrics
- **Completeness:** {avg["completeness"]:.2f}/5
- **Accuracy:** {avg["accuracy"]:.2f}/5
- **No Hallucinations:** {avg["no_hallucinations"]:.2f}/5
- **Clinical Safety:** {avg["clinical_safety"]:.2f}/5
- **Coherence:** {avg["coherence"]:.2f}/5
- **Weighted Overall Score:** {avg["weighted_score"]:.2f}/5

## Improvement Recommendations
{improvement_analysis}

## Case Metrics
"""
        
        for case_id, metrics in cases.items():
            report += f"""
### {case_id}
- **Completeness:** {metrics["completeness"]:.2f}/5
- **Accuracy:** {metrics["accuracy"]:.2f}/5
- **No Hallucinations:** {metrics["no_hallucinations"]:.2f}/5
- **Clinical Safety:** {metrics["clinical_safety"]:.2f}/5
- **Coherence:** {metrics["coherence"]:.2f}/5
- **Weighted Overall Score:** {metrics["weighted_score"]:.2f}/5
"""
        
        return report


def confirm_run(config):
    """Get user confirmation to proceed with evaluation"""
    config.display()
    
    while True:
        response = input("Proceed with this evaluation configuration? (y/n): ").strip().lower()
        if response == 'y':
            return True
        elif response == 'n':
            return False
        print("Please enter 'y' or 'n'")


def main():
    parser = argparse.ArgumentParser(description="Physiotherapy report evaluation")
    parser.add_argument("--config", default="test/eval-config.json", help="Config file (default: test/eval-config.json)")
    parser.add_argument("--no-confirm", action="store_true", help="Skip confirmation prompt")
    
    args = parser.parse_args()
    
    try:
        # Load config
        config = EvalConfig(args.config)
        
        # Get confirmation unless --no-confirm
        if not args.no_confirm and not confirm_run(config):
            print("Evaluation cancelled")
            return 0
            
        # Create and run evaluator
        evaluator = Evaluator(config).setup()
        evaluator.execute()
        
    except Exception as e:
        logger.error(f"Evaluation error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 1
        
    return 0


if __name__ == "__main__":
    exit(main())