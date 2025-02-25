#!/usr/bin/env python3

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

def setup_logging(log_file: str, level=logging.INFO) -> logging.Logger:
    """Set up consistent logging across scripts"""
    logger = logging.getLogger('physio-utils')
    logger.setLevel(level)
    
    # Clear existing handlers if any
    if logger.hasHandlers():
        logger.handlers.clear()
    
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    
    # File handler
    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    return logger

def load_config(config_file: str, required_fields: list, default_values: Dict = None) -> Dict:
    """Load and validate configuration file"""
    if not os.path.exists(config_file):
        raise FileNotFoundError(f"Config file not found: {config_file}")
        
    with open(config_file, 'r') as f:
        config = json.load(f)
    
    # Validate required fields
    missing = [f for f in required_fields if f not in config]
    if missing:
        raise ValueError(f"Missing required config fields: {', '.join(missing)}")
    
    # Set defaults
    if default_values:
        for key, value in default_values.items():
            config.setdefault(key, value)
            
    return config

def save_json(data: Any, file_path: str, indent: int = 2) -> None:
    """Save data to JSON file with proper directory creation"""
    # Create parent directory if it doesn't exist
    directory = os.path.dirname(file_path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
        
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=indent)

def ensure_dir(directory: str) -> None:
    """Ensure directory exists, creating it if necessary"""
    if directory:
        Path(directory).mkdir(parents=True, exist_ok=True)

def display_config(config: Dict) -> None:
    """Print configuration in a readable format"""
    print("\n--- CONFIGURATION ---")
    for key, value in config.items():
        print(f"{key}: {value}")
    print("-------------------\n")

def confirm_run() -> bool:
    """Get user confirmation to proceed"""
    while True:
        response = input("Proceed with this configuration? (y/n): ").strip().lower()
        if response == 'y':
            return True
        elif response == 'n':
            return False
        print("Please enter 'y' or 'n'")