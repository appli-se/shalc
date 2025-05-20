// hal_ir.js
function astToIR(ast) {
    // Flattened example: map functions/procedures to IR
    const ir = [];
    for (const item of ast.items) {
        if (item.type === "Function" || item.type === "Procedure") {
            ir.push({
                kind: item.type,
                name: item.name,
                params: item.params,
                body: item.body.statements,
            });
        }
    }
    return ir;
}

module.exports = { astToIR };
