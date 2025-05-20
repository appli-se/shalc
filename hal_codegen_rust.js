// hal_codegen.js

function genRust(ast) {
    let out = ["mod hal { type RoundMode = (); }"];
    for (const item of ast.items) {
        if (item.type === "Function") {
            out.push(genFunction(item));
        } else if (item.type === "Procedure") {
            out.push(genProcedure(item));
        }
    }
    return out.join("\n\n");
}

function rustType(halType) {
    switch (halType.toLowerCase()) {
        case "integer": return "i32";
        case "longint": return "i64";
        case "boolean": return "bool";
        case "string":  return "String";
        case "roundmode": return "hal::RoundMode";
        default: return "/* unknown: " + halType + " */";
    }
}

// Track variables declared in the block
function genBlock(block, paramNames = []) {
    let declared = new Set(paramNames);
    let code = [];
    for (const stmt of block.statements) {
        if (stmt.type === "VarDeclaration") {
            for (const name of stmt.names) {
                // Declare all variables with let mut and the right type (init to default)
                code.push(`let mut ${name}: ${rustType(stmt.halType)} = ${defaultValueRust(stmt.halType)};`);
                declared.add(name);
            }
        } else if (stmt.type === "Assignment") {
            code.push(`${stmt.left} = ${genExpr(stmt.expr)};`);
        } else if (stmt.type === "Return") {
            code.push(`return ${genExpr(stmt.expr)};`);
        } else if (stmt.type === "ExpressionStatement") {
            code.push(`${genExpr(stmt.expr)};`);
        } else {
            code.push(`/* Unhandled statement: ${stmt.type} */`);
        }
    }
    return code.join("\n");
}

function defaultValueRust(halType) {
    switch (halType.toLowerCase()) {
        case "integer":  return "0";
        case "longint":  return "0";
        case "boolean":  return "false";
        case "string":   return "String::new()";
        case "roundmode": return "Default::default()";
        default:         return "Default::default()";
    }
}

function genFunction(fn) {
    const params = fn.params.map(
        p => `${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const retType = rustType(fn.returnType) || "i32";
    const pub = fn.modifiers && fn.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    return `${pub}fn ${fn.name}(${params}) -> ${retType} {\n${indent(genBlock(fn.body, fn.params.map(p => p.name)))}\n}`;
}

function genProcedure(proc) {
    const params = proc.params.map(
        p => `${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const pub = proc.modifiers && proc.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    return `${pub}fn ${proc.name}(${params}) {\n${indent(genBlock(proc.body, proc.params.map(p => p.name)))}\n}`;
}

function genExpr(expr) {
    switch (expr.type) {
        case "Identifier":      return expr.name;
        case "NumberLiteral":   return expr.value.toString();
        case "StringLiteral":   return JSON.stringify(expr.value);
        case "BinaryExpression":return `${genExpr(expr.left)} ${opRust(expr.operator)} ${genExpr(expr.right)}`;
        default:
            return `/* Unhandled expr: ${expr.type} */`;
    }
}

function opRust(op) {
    switch (op) {
        case "PLUS":  return "+";
        case "MINUS": return "-";
        case "MULTIPLY": return "*";
        case "DIVIDE": return "/";
        default: return op;
    }
}

function indent(str, prefix = "    ") {
    return str.split("\n").map(line => prefix + line).join("\n");
}

module.exports = { genRust };
