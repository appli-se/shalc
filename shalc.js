const { parse, ParseError } = require('./hal_parser');
const { genRust } = require('./hal_codegen_rust');

let ast;
try {
    const code = `
        global
        function integer foo(integer x, integer y)
        begin
            integer z;
            z = x + y;
            return z;
        end;
    `;
    ast = parse(code);
} catch (e) {
    if (e instanceof ParseError) {
        console.error(e.message);
        process.exit(1);
    } else {
        throw e;
    }
}
console.dir(ast, { depth: 10 });

console.log("\n// ---- Rust Output ----\n");
console.log(genRust(ast));
