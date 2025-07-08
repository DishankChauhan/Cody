import pytest
from main import parse_code_edits


class TestCodeEditParsing:
    """Test code edit parsing functionality"""
    
    def test_parse_single_code_edit(self):
        """Test parsing a single code edit block"""
        response = """Here's the fixed code:

```edit:src/main.py
def hello_world():
    print("Hello, World!")
```

This should work better."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Check cleaned response
        expected_cleaned = """Here's the fixed code:



This should work better."""
        assert cleaned_response == expected_cleaned
        
        # Check code edits
        assert len(code_edits) == 1
        edit = code_edits[0]
        assert edit.file == "src/main.py"
        assert edit.newText == 'def hello_world():\n    print("Hello, World!")'
        assert edit.range["start"]["line"] == 0
        assert edit.range["start"]["character"] == 0

    def test_parse_multiple_code_edits(self):
        """Test parsing multiple code edit blocks"""
        response = """I'll update both files:

```edit:src/main.py
def main():
    print("Updated main")
```

And also:

```edit:src/utils.py
def utility():
    return "Updated utility"
```

Both files are now improved."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Check cleaned response doesn't contain edit blocks
        assert "```edit:" not in cleaned_response
        assert "def main():" not in cleaned_response
        assert "def utility():" not in cleaned_response
        assert "Both files are now improved." in cleaned_response
        
        # Check code edits
        assert len(code_edits) == 2
        
        # First edit
        edit1 = code_edits[0]
        assert edit1.file == "src/main.py"
        assert 'def main():' in edit1.newText
        
        # Second edit
        edit2 = code_edits[1]
        assert edit2.file == "src/utils.py"
        assert 'def utility():' in edit2.newText

    def test_parse_code_edit_with_current_file(self):
        """Test parsing code edit that uses current file"""
        response = """Here's the fix:

```edit:
function fixedFunction() {
    return "fixed";
}
```

Applied to current file."""
        
        current_file = "current.js"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Should use current file when no file specified
        assert len(code_edits) == 1
        edit = code_edits[0]
        assert edit.file == "current.js"
        assert "fixedFunction" in edit.newText

    def test_parse_code_edit_no_current_file(self):
        """Test parsing code edit with no current file specified"""
        response = """Here's the fix:

```edit:
function fixedFunction() {
    return "fixed";
}
```

No current file specified."""
        
        current_file = None
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Should skip edit when no file can be determined
        assert len(code_edits) == 0
        assert "No current file specified." in cleaned_response

    def test_parse_no_code_edits(self):
        """Test parsing response with no code edit blocks"""
        response = """This is just a regular response with some code examples:

```python
def example():
    print("This is not an edit block")
```

No edits to apply."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Response should be unchanged
        assert cleaned_response == response
        assert len(code_edits) == 0

    def test_parse_mixed_code_blocks(self):
        """Test parsing response with both edit blocks and regular code blocks"""
        response = """Here's an example:

```python
def example():
    print("This is just an example")
```

And here's the actual edit:

```edit:src/fix.py
def fixed_function():
    print("This is the fix")
```

Regular code blocks should remain."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        # Should preserve regular code blocks but remove edit blocks
        assert "```python" in cleaned_response
        assert "def example():" in cleaned_response
        assert "```edit:" not in cleaned_response
        assert "def fixed_function():" not in cleaned_response
        
        # Should have one edit
        assert len(code_edits) == 1
        assert code_edits[0].file == "src/fix.py"

    def test_parse_multiline_code_edit(self):
        """Test parsing code edit with multiple lines and proper formatting"""
        response = """Here's a complex function:

```edit:src/complex.py
class ComplexClass:
    def __init__(self):
        self.value = 0
    
    def increment(self):
        self.value += 1
        return self.value
    
    def decrement(self):
        self.value -= 1
        return self.value
```

This is a complete class implementation."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        assert len(code_edits) == 1
        edit = code_edits[0]
        assert edit.file == "src/complex.py"
        
        # Check that multiline content is preserved
        assert "class ComplexClass:" in edit.newText
        assert "def __init__(self):" in edit.newText
        assert "def increment(self):" in edit.newText
        assert "def decrement(self):" in edit.newText

    def test_parse_empty_code_edit(self):
        """Test parsing empty code edit block"""
        response = """Here's an empty edit:

```edit:src/empty.py
```

This creates an empty file."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        assert len(code_edits) == 1
        edit = code_edits[0]
        assert edit.file == "src/empty.py"
        assert edit.newText == ""

    def test_parse_code_edit_with_special_characters(self):
        """Test parsing code edit with special characters and symbols"""
        response = """Here's code with special characters:

```edit:src/special.py
def special_function():
    # This function has special characters: !@#$%^&*()
    regex_pattern = r"[\\w\\-\\.]+@[\\w\\-\\.]+\\.\\w+"
    return f"Pattern: {regex_pattern}"
```

Contains regex and formatting."""
        
        current_file = "test.py"
        cleaned_response, code_edits = parse_code_edits(response, current_file)
        
        assert len(code_edits) == 1
        edit = code_edits[0]
        assert "!@#$%^&*()" in edit.newText
        assert "regex_pattern" in edit.newText
        assert "special_function" in edit.newText

    def test_parse_code_edit_error_handling(self):
        """Test error handling in code edit parsing"""
        # Test with malformed input that might cause exceptions
        test_cases = [
            "",  # Empty string
            "```edit:",  # Incomplete edit block
            "```edit:file.py",  # Missing closing backticks
            "```edit:file.py\ncontent\n```extra",  # Extra content after closing
        ]
        
        for test_input in test_cases:
            # Should not raise exception, should handle gracefully
            cleaned_response, code_edits = parse_code_edits(test_input, "test.py")
            assert isinstance(cleaned_response, str)
            assert isinstance(code_edits, list)

    def test_parse_code_edit_range_structure(self):
        """Test that code edit range structure is correct"""
        response = """```edit:test.py
print("hello")
```"""
        
        cleaned_response, code_edits = parse_code_edits(response, "test.py")
        
        assert len(code_edits) == 1
        edit = code_edits[0]
        
        # Check range structure
        assert "range" in edit.__dict__
        assert "start" in edit.range
        assert "end" in edit.range
        assert "line" in edit.range["start"]
        assert "character" in edit.range["start"]
        assert "line" in edit.range["end"]
        assert "character" in edit.range["end"]
        
        # Check range values
        assert edit.range["start"]["line"] == 0
        assert edit.range["start"]["character"] == 0
        assert edit.range["end"]["line"] == 999999
        assert edit.range["end"]["character"] == 999999 