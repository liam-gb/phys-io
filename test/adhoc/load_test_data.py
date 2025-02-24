
import re
import json
import os
from datetime import datetime
from pathlib import Path
import argparse
import logging

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('extractor')

def extract_patient_data(content):
    """Extract patients and reference letters from raw content."""
    # Remove "RAW DATA:" header if present
    content = re.sub(r'^RAW DATA:\s*', '', content, flags=re.IGNORECASE)
    
    logger.debug(f"Processing file with {len(content)} characters")
    
    # Let's try a direct pattern match for the actual format in the file
    patients = {}
    
    # Based on the actual content structure in paste.txt:
    # First, try exact patterns from the sample
    patient_patterns = [
        # Patient A
        (r'Patient A Notes:(.*?)Letter for Patient A:', 'A', 'notes'),
        (r'Letter for Patient A:(.*?)Patient B Notes:', 'A', 'reference'),
        
        # Patient B
        (r'Patient B Notes:(.*?)Patient B Letter:', 'B', 'notes'),
        (r'Patient B Letter:(.*?)Patient C Notes:', 'B', 'reference'),
        
        # Patient C - may be at the end of the file
        (r'Patient C Notes:(.*?)Patient C Letter:', 'C', 'notes'),
        (r'Patient C Letter:(.*?)(?:Patient D|$)', 'C', 'reference')
    ]
    
    # Try each pattern
    for pattern, patient_id, section_type in patient_patterns:
        match = re.search(pattern, content, re.DOTALL)
        if match:
            if patient_id not in patients:
                patients[patient_id] = {"id": f"patient_{patient_id.lower()}"}
            
            patients[patient_id][section_type] = match.group(1).strip()
            logger.debug(f"Found {section_type} for Patient {patient_id}")
    
    # If that didn't work, try a more generic approach
    if not patients:
        logger.debug("No exact matches, trying a more generic approach")
        
        # Look for all patient sections
        matches = re.findall(r'(Patient ([A-Z]) Notes:|Letter for Patient ([A-Z]):)(.*?)(?=Patient [A-Z] Notes:|Letter for Patient [A-Z]:|$)', 
                            content, re.DOTALL)
        
        for header, id1, id2, text in matches:
            patient_id = id1 if id1 else id2
            section_type = "notes" if "Notes" in header else "reference"
            
            if patient_id not in patients:
                patients[patient_id] = {"id": f"patient_{patient_id.lower()}"}
            
            patients[patient_id][section_type] = text.strip()
            logger.debug(f"Generic approach: Found {section_type} for Patient {patient_id}")
    
    # If we still don't have any patients, try one more approach based on the actual content
    if not patients:
        logger.debug("Trying raw text parsing approach")
        
        # Directly look for known text patterns from your provided sample
        if "Patient A Notes:" in content:
            start_idx = content.index("Patient A Notes:") + len("Patient A Notes:")
            end_idx = content.index("Letter for Patient A:", start_idx) if "Letter for Patient A:" in content else len(content)
            
            patients["A"] = {"id": "patient_a", "notes": content[start_idx:end_idx].strip()}
            logger.debug("Found Patient A notes through direct text search")
            
            # Try to extract letter too
            if "Letter for Patient A:" in content:
                start_idx = content.index("Letter for Patient A:") + len("Letter for Patient A:")
                end_idx = content.index("Patient B Notes:", start_idx) if "Patient B Notes:" in content else len(content)
                
                patients["A"]["reference"] = content[start_idx:end_idx].strip()
                logger.debug("Found Patient A letter through direct text search")
    
    # Log the results
    logger.debug(f"Found {len(patients)} patients: {list(patients.keys())}")
    for patient_id, data in patients.items():
        for section_type in data:
            if section_type != "id":
                content_preview = data[section_type][:50].replace('\n', ' ') + "..."
                logger.debug(f"Patient {patient_id} {section_type}: {content_preview}")
    
    return list(patients.values())

def clean_text(text):
    """Clean up text formatting issues."""
    # Replace escaped backslashes that aren't escapes
    text = re.sub(r'\\([^ntrab\'\"\\])', r'\1', text)
    return text

def extract_and_save(input_file, output_file=None):
    """Extract test data and save to JSON."""
    # Read the input file
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Clean the text
    content = clean_text(content)
    
    # Extract patient data
    patients = extract_patient_data(content)
    
    if not patients:
        logger.error("No patient data found in input file")
        return None
    
    # Generate default output filename if not provided
    if not output_file:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = f"test_data_{timestamp}.json"
    
    # Ensure directory exists
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write to JSON file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(patients, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Extracted {len(patients)} patients from {input_file}")
    logger.info(f"Saved to {output_path}")
    
    return output_path

def main():
    parser = argparse.ArgumentParser(description="Extract patient test data from raw notes")
    parser.add_argument("input", help="Input text file with patient notes")
    parser.add_argument("--output", help="Output JSON file (default: test_data_TIMESTAMP.json)")
    
    args = parser.parse_args()
    
    try:
        extract_and_save(args.input, args.output)
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())