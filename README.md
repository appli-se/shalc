# shalc

A small experiment implementing a HAL (Hypothetical Assembly Language) parser and simple Rust and Python code generators.

## Usage

1. Place your `.hal` source files anywhere in the project. A sample file is provided at `hal/sample.hal`.
   Another file `hal/sample_external.hal` demonstrates declarations of external
   functions and procedures.
2. Run the compiler with Node.js, passing the path to the `.hal` file. Optionally specify `rust` or `python` as the output language:

```bash
node shalc.js hal/sample.hal rust
node shalc.js hal/sample.hal python
```

The command writes a file next to the input with the `.rs` or `.py` extension depending on the selected language (for the sample above, `hal/sample.rs` or `hal/sample.py`).

## Sample

The provided `sample.hal` contains a global function `foo` and a procedure `bar`.
Running the command with `rust` produces `sample.rs` while `python` produces `sample.py`.

### Record Variables

The compiler understands simple `record` variable declarations such as:

```
record A a;
```

This will result in Rust code using the corresponding struct from a `datadef`
module and initializing the variable with `Default::default()`:

```
use datadef::A;
let mut a: A = Default::default();
```

Field accesses like `a.foo` are allowed without validating whether the field
exists in the record.

### Row Variables

`row` variables work the same way as `record` variables. The syntax is

```
row A r;
```

This currently generates the same Rust code as a `record` variable and simply
initializes the struct with `Default::default()`.

### Array Variables

Array variables can be declared using the `array` keyword:

```
array integer nums;
```

Indexing expressions like `nums[0]` are supported and translated to Rust vector
syntax. Array variables become `Vec` types in the generated Rust code.

### Switch Statements

Switch statements following the HAL syntax are supported and are translated into
Rust `match` expressions.

### Labels and Goto

Simple labels (`label:`) and `goto` statements are translated to Rust labelled
loops. A `goto` that jumps back to a previously defined label becomes a
`continue` to that loop.

### Async Procedure Calls

Procedure calls can optionally be prefixed with an asynchronous queue name
followed by a period. Currently the predefined queue is `clientremoteasync`.
A call like

```hal
clientremoteasync.MyProc(1);
```

is parsed and emitted as a commented placeholder in the generated Rust code.
