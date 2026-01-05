import os
import sys
import subprocess
import re

def find_line_number(lines, key_path):
    """
    Finds the line number of a key in a YAML file using a state-machine parser.
    Handles nested keys and duplicate key names in different scopes.
    Returns 1-based line number or -1 if not found.
    """
    parts = key_path.split('.')
    current_idx = 0
    parent_indents = [] # Stack of indents for matched path parts
    
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        # Skip comments and empty lines
        if not stripped or stripped.startswith('#'):
            continue
            
        indent = len(line) - len(stripped)
        
        # Check if we left the scope of previous parents
        # If indent <= last matched parent's indent, we popped out of that block
        while parent_indents and indent <= parent_indents[-1]:
            parent_indents.pop()
            current_idx -= 1
        
        # Match the current expected part
        target = parts[current_idx]
        
        # Regex matches "key:" or "key: value"
        # STRICT match on key name to avoid partial matches (e.g. 'api' vs 'api_key')
        if re.match(rf'^{re.escape(target)}\s*:', stripped):
            # If this is the final part of the key
            if current_idx == len(parts) - 1:
                return i + 1 # Return 1-based line number
            
            # Found a parent, go deeper
            parent_indents.append(indent)
            current_idx += 1
    
    return -1

def smart_quote(value):
    """
    Quotes a string value only if necessary for YAML validity.
    """
    if value in ('true', 'false'):
        return value
    elif re.match(r'^-?[0-9]+\.?[0-9]*$', value):
        return value
    
    # String - only quote if it contains characters that require quoting
    # YAML needs quotes for: leading/trailing spaces, ": " sequence, certain special chars at start
    needs_quotes = (
        value != value.strip() or  # leading/trailing whitespace
        ': ' in value or           # colon-space is a key-value separator
        value.startswith(('#', '&', '*', '!', '|', '>', '@', '`', '%', '-')) or  # special start chars
        any(c in value for c in ':{}[]#,*&?') or # Special chars that might confuse parsers
        value.lower() in ('yes', 'no', 'on', 'off', 'null', '~')  # reserved words
    )
    
    if needs_quotes:
        # Add quotes and escape existing quotes
        # chr(34) = "
        # chr(92) = \
        # This replaces " with \" without getting into quoting hell in the source code
        return f'"{value.replace(chr(34), chr(92)+chr(34))}"'
    
    return value

def get_old_value(file_path, key_path):
    """
    Uses yq to validate key existence and retrieve the current value.
    """
    result = subprocess.run(['yq', 'eval', f'.{key_path}', file_path], 
                          capture_output=True, text=True)
    val = result.stdout.strip()
    
    if val == 'null' or result.returncode != 0:
        return None
    return val

def modify_yaml_file(file_path, key_path, new_value):
    # Validate file exists
    if not os.path.exists(file_path):
        print(f"::error::File not found: {file_path}")
        sys.exit(1)

    # 1. Validation & Old Value
    old_value = get_old_value(file_path, key_path)
    if old_value is None:
        print(f"::error::Key '{key_path}' not found in {file_path}")
        sys.exit(1)
    
    print(f"Old value: {old_value}")
    
    # 2. Read all lines
    with open(file_path, 'r') as f:
        lines = f.readlines()
    
    # 3. Find target line
    line_num = find_line_number(lines, key_path)
    if line_num == -1:
        print(f"::error::Could not find line number for key: {key_path}")
        sys.exit(1)
        
    print(f"Found '{key_path}' on line {line_num}")
    
    # 4. Prepare new line content
    formatted_value = smart_quote(new_value)
    
    target_line = lines[line_num - 1] # line_num is 1-indexed
    
    # Extract original indent and comment to preserve them
    indent_match = re.match(r'^(\s*)', target_line)
    indent = indent_match.group(1) if indent_match else ''
    
    comment_match = re.search(r'(#.*)$', target_line)
    comment = '  ' + comment_match.group(1) if comment_match else ''
    
    final_key = key_path.split('.')[-1]
    
    # 5. Modify line
    lines[line_num - 1] = f'{indent}{final_key}: {formatted_value}{comment}\n'
    
    # 6. Write back
    with open(file_path, 'w') as f:
        f.writelines(lines)
        
    return old_value

def main():
    file_path = os.environ.get('INPUT_FILE')
    key_path = os.environ.get('INPUT_KEY')
    input_value = os.environ.get('INPUT_VALUE')
    
    if not all([file_path, key_path, input_value]):
        print("::error::Missing required inputs: FILE, KEY, or VALUE")
        sys.exit(1)

    print(f"Modifying {key_path} in {file_path}...")
    
    old_val = modify_yaml_file(file_path, key_path, input_value)
    
    print(f"✅ Modified {key_path} to: {input_value}")
    
    # Set outputs
    if 'GITHUB_OUTPUT' in os.environ:
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f'old-value={old_val}\n')
            f.write(f'new-value={input_value}\n')

if __name__ == '__main__':
    main()
