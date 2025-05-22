# shalc

A small experiment implementing a HAL (Hypothetical Assembly Language) parser and a simple Python code generator.

## Usage

1. Place your `.hal` source files anywhere in the project. A sample file is provided at `hal/sample.hal`.
   Another file `hal/sample_external.hal` demonstrates declarations of external
   functions and procedures.
2. Run the compiler with Node.js, passing the path to the `.hal` file:

```bash
node shalc.js hal/sample.hal
```

This command writes a Python file next to the input with the `.py` extension (for the sample above, `hal/sample.py`).

## Sample

The provided `sample.hal` contains a global function `foo` and a procedure `bar`.
After running the command above you will find `sample.py` with the generated Python code.

### Record Variables

The compiler understands simple `record` variable declarations such as:

```
record A a;
```

This will result in Python code initializing the variable using the `datadef`
module:

```
from datadef import A
a = A()
```

Field accesses like `a.foo` are allowed without validating whether the field
exists in the record.

### Row Variables

`row` variables work the same way as `record` variables. The syntax is

```
row A r;
```

This currently generates the same Python code as a `record` variable and simply
creates a new instance of the struct.

### Array Variables

Array variables can be declared using the `array` keyword:

```
array integer nums;
```

Indexing expressions like `nums[0]` are supported and translated to Python list
syntax. Array variables become `list` types in the generated Python code.

### Switch Statements

Switch statements following the HAL syntax are supported and are translated into
Python `if`/`elif` chains.

### Labels and Goto

Simple labels (`label:`) and `goto` statements are implemented using a loop with
a program counter variable. A `goto` that jumps back to a previously defined
label becomes a `continue` to that loop.

### Async Procedure Calls

Procedure calls can optionally be prefixed with an asynchronous queue name
followed by a period. Currently the predefined queue is `clientremoteasync`.
A call like

```hal
clientremoteasync.MyProc(1);
```

is parsed and emitted as a commented placeholder in the generated Python code.
