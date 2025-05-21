// hal_codegen.js

function genRust(ast) {
    let out = ["mod hal { type RoundMode = (); }"];
    for (const item of ast.items) {
        if (item.type === "Function") {
            out.push(genFunction(item));
        } else if (item.type === "Procedure") {
            out.push(genProcedure(item));
        } else if (item.type === "ExternalFunction" || item.type === "ExternalProcedure") {
            // External declarations have no body; emit a comment for now
            out.push(`// external ${item.type === "ExternalFunction" ? "function" : "procedure"} ${item.name}`);
        }
    }
    return out.join("\n\n");
}

function rustType(halType) {
    let base = typeof halType === "object" ? halType.base : halType;
    switch ((base || "").toLowerCase()) {
        case "integer": return "i32";
        case "longint": return "i64";
        case "boolean": return "bool";
        case "string":  return "String";
        case "roundmode": return "hal::RoundMode";
        case "val": return "f64";
        default: return "/* unknown: " + base + " */";
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
            if (stmt.expr) {
                code.push(`return ${genExpr(stmt.expr)};`);
            } else {
                code.push(`return;`);
            }
        } else if (stmt.type === "ExpressionStatement") {
            code.push(`${genExpr(stmt.expr)};`);
        } else if (stmt.type === "IfStatement") {
            const cond = genExpr(stmt.condition);
            const thenCode = indent(genBlock(stmt.consequent));
            if (stmt.alternate) {
                const elseCode = indent(genBlock(stmt.alternate));
                code.push(`if ${cond} {\n${thenCode}\n} else {\n${elseCode}\n}`);
            } else {
                code.push(`if ${cond} {\n${thenCode}\n}`);
            }
        } else if (stmt.type === "WhileStatement") {
            const cond = genExpr(stmt.condition);
            const body = indent(genBlock(stmt.body));
            code.push(`while ${cond} {\n${body}\n}`);
        } else if (stmt.type === "ForStatement") {
            const initLine = `${stmt.init.left} = ${genExpr(stmt.init.expr)};`;
            const cond = genExpr(stmt.condition);
            const updateLine = `${stmt.update.left} = ${genExpr(stmt.update.expr)};`;
            const body = indent(genBlock(stmt.body));
            code.push(`{`);
            code.push(indent(initLine));
            code.push(indent(`while ${cond} {`));
            code.push(indent(indent(body)));
            code.push(indent(indent(updateLine)));
            code.push(indent(`}`));
            code.push(`}`);
        } else {
            code.push(`/* Unhandled statement: ${stmt.type} */`);
        }
    }
    return code.join("\n");
}

function defaultValueRust(halType) {
    let base = typeof halType === "object" ? halType.base : halType;
    switch ((base || "").toLowerCase()) {
        case "integer":  return "0";
        case "longint":  return "0";
        case "boolean":  return "false";
        case "string":   return "String::new()";
        case "roundmode": return "Default::default()";
        case "val": return "0.0";
        default:         return "Default::default()";
    }
}

function genFunction(fn) {
    const params = fn.params.map(
        p => `${p.modifiers && p.modifiers.includes("VAR_KEYWORD") ? "mut " : ""}${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const retType = rustType(fn.returnType) || "i32";
    const pub = fn.modifiers && fn.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    return `${pub}fn ${fn.name}(${params}) -> ${retType} {\n${indent(genBlock(fn.body, fn.params.map(p => p.name)))}\n}`;
}

function genProcedure(proc) {
    const params = proc.params.map(
        p => `${p.modifiers && p.modifiers.includes("VAR_KEYWORD") ? "mut " : ""}${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const pub = proc.modifiers && proc.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    return `${pub}fn ${proc.name}(${params}) {\n${indent(genBlock(proc.body, proc.params.map(p => p.name)))}\n}`;
}

function genExpr(expr) {
    switch (expr.type) {
        case "Identifier":      return expr.name;
        case "NumberLiteral":   return expr.value.toString();
        case "StringLiteral":   return JSON.stringify(expr.value);
        case "BooleanLiteral":  return expr.value ? "true" : "false";
        case "BinaryExpression":
            if (expr.operator === "AMPERSAND") {
                return `format!(\"{}{}\", ${genExpr(expr.left)}, ${genExpr(expr.right)})`;
            }
            return `${genExpr(expr.left)} ${opRust(expr.operator)} ${genExpr(expr.right)}`;
        case "UnaryExpression":
            return `${opRust(expr.operator)}${genExpr(expr.argument)}`;
        case "CallExpression":
            switch (expr.callee.toLowerCase()) {
                case "len":
                    // assume single argument, return length as i32
                    return `${genExpr(expr.args[0])}.len() as i32`;
                case "mid": {
                    // Mid(string,start,len)
                    const s = genExpr(expr.args[0]);
                    const start = genExpr(expr.args[1]);
                    const len = genExpr(expr.args[2]);
                    return `${s}[(${start}) as usize..(${start} + ${len}) as usize].to_string()`;
                }
                default:
                    return `${expr.callee}(${expr.args.map(a => genExpr(a)).join(", ")})`;
            }
        case "ParenExpression":
            return `(${genExpr(expr.expr)})`;
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
        case "LESS": return "<";
        case "LESS_OR_EQUAL": return "<=";
        case "GREATER": return ">";
        case "GREATER_OR_EQUAL": return ">=";
        case "EQEQ": return "==";
        case "NOT_EQUALS": return "!=";
        case "AND_KEYWORD": return "&&";
        case "OR_KEYWORD": return "||";
        case "NOT_KEYWORD": return "!";
        case "NOT_OP": return "!";
        default: return op;
    }
}

function indent(str, prefix = "    ") {
    return str.split("\n").map(line => prefix + line).join("\n");
}

module.exports = { genRust };
