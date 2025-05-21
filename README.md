# shalc

A small experiment implementing a HAL (Hypothetical Assembly Language) parser and a simple Rust code generator.

## Usage

1. Place your `.hal` source files anywhere in the project. A sample file is provided at `hal/sample.hal`.
   Another file `hal/sample_external.hal` demonstrates declarations of external
   functions and procedures.
2. Run the compiler with Node.js, passing the path to the `.hal` file:

```bash
node shalc.js hal/sample.hal
```

This command writes a Rust file next to the input with the `.rs` extension (for the sample above, `hal/sample.rs`).

## Sample

The provided `sample.hal` contains a global function `foo` and a procedure `bar`.
After running the command above you will find `sample.rs` with the generated Rust code.

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
