// test.js
const fs = require('fs');
const { parse, ParseError } = require('./hal_parser');
const { astToIR } = require('./hal_ir');

const halCode = `
function integer foo(integer x, integer y)
begin
    z = x + y;
    return z;
end;
`;

try {
    const ast = parse(halCode);
    console.dir(ast, { depth: 10 });
    const ir = astToIR(ast);
    console.dir(ir, { depth: 10 });
} catch (e) {
    if (e instanceof ParseError) {
        console.error(e.message);
        process.exit(1);
    } else {
        throw e;
    }
}
