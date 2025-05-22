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
        case "array":
            return `Vec<${rustType(halType.elementType)}>`;
        case "record":
        case "row":
            return halType.record;
        default: return "/* unknown: " + base + " */";
    }
}

// Track variables declared in the block
let currentFunctionName = null;

function genBlock(block, paramNames = [], ctx = null) {
    let declared = new Set(paramNames);
    let code = [];
    let openLabel = null;
    for (const stmt of block.statements) {
        if (stmt.type === "VarDeclaration") {
            for (const name of stmt.names) {
                if (stmt.halType.base && ["record", "row"].includes(stmt.halType.base.toLowerCase())) {
                    code.push(`use datadef::${stmt.halType.record};`);
                    code.push(`let mut ${name}: ${stmt.halType.record} = Default::default();`);
                } else {
                    code.push(`let mut ${name}: ${rustType(stmt.halType)} = ${defaultValueRust(stmt.halType)};`);
                }
                declared.add(name);
            }
        } else if (stmt.type === "Assignment") {
            code.push(`${genExpr(stmt.left)} = ${genExpr(stmt.expr)};`);
        } else if (stmt.type === "Return") {
            if (stmt.expr) {
                code.push(`return ${genExpr(stmt.expr)};`);
            } else {
                if (currentFunctionName) {
                    code.push(`return ${currentFunctionName};`);
                } else {
                    code.push(`return;`);
                }
            }
        } else if (stmt.type === "ExpressionStatement") {
            code.push(`${genExpr(stmt.expr)};`);
        } else if (stmt.type === "LabelStatement") {
            if (ctx) {
                // labels inside basic block are handled at a higher level
                continue;
            }
            if (openLabel) {
                code.push(`break;`);
                code.push(`}`);
            }
            code.push(`'${stmt.label}: loop {`);
            openLabel = stmt.label;
        } else if (stmt.type === "GotoStatement") {
            if (ctx) {
                const target = ctx.labelMap.get(stmt.label);
                code.push(`${ctx.pcVar} = ${target};`);
                code.push(`continue '${ctx.loopLabel};`);
            } else {
                code.push(`continue '${stmt.label};`);
            }
        } else if (stmt.type === "IfStatement") {
            const cond = genExpr(stmt.condition);
            const thenCode = indent(genBlock(stmt.consequent, [], ctx));
            if (stmt.alternate) {
                const elseCode = indent(genBlock(stmt.alternate, [], ctx));
                code.push(`if ${cond} {\n${thenCode}\n} else {\n${elseCode}\n}`);
            } else {
                code.push(`if ${cond} {\n${thenCode}\n}`);
            }
        } else if (stmt.type === "WhileStatement") {
            const cond = genExpr(stmt.condition);
            const body = indent(genBlock(stmt.body, [], ctx));
            code.push(`while ${cond} {\n${body}\n}`);
        } else if (stmt.type === "ForStatement") {
            const initLine = `${genExpr(stmt.init.left)} = ${genExpr(stmt.init.expr)};`;
            const cond = genExpr(stmt.condition);
            const updateLine = `${genExpr(stmt.update.left)} = ${genExpr(stmt.update.expr)};`;
            const body = indent(genBlock(stmt.body, [], ctx));
            code.push(`{`);
            code.push(indent(initLine));
            code.push(indent(`while ${cond} {`));
            code.push(indent(indent(body)));
            code.push(indent(indent(updateLine)));
            code.push(indent(`}`));
            code.push(`}`);
        } else if (stmt.type === "SwitchStatement") {
            const disc = genExpr(stmt.discriminant);
            let arms = [];
            for (const cs of stmt.cases) {
                const pat = cs.values.map(v => genExpr(v)).join(" | ");
                const body = indent(genBlock({ statements: cs.body }, [], ctx));
                arms.push(`${pat} => {\n${body}\n}`);
            }
            if (stmt.otherwise && stmt.otherwise.length > 0) {
                const body = indent(genBlock({ statements: stmt.otherwise }, [], ctx));
                arms.push(`_ => {\n${body}\n}`);
            }
            code.push(`match ${disc} {\n${indent(arms.join(",\n"))}\n}`);
        } else if (stmt.type === "AsyncCallStatement") {
            const args = stmt.args.map(a => genExpr(a)).join(", ");
            code.push(`// async ${stmt.queue}.${stmt.callee}(${args})`);
        } else {
            code.push(`/* Unhandled statement: ${stmt.type} */`);
        }
    }
    if (openLabel && !ctx) {
        code.push(`break;`);
        code.push(`}`);
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
        case "array": return "Vec::new()";
        default:         return "Default::default()";
    }
}

function genFunction(fn) {
    const params = fn.params.map(
        p => `${p.modifiers && p.modifiers.includes("VAR_KEYWORD") ? "mut " : ""}${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const retType = rustType(fn.returnType) || "i32";
    const pub = fn.modifiers && fn.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    const retVarDecl = `let mut ${fn.name}: ${retType} = ${defaultValueRust(fn.returnType)};`;
    currentFunctionName = fn.name;
    const { decls, matchCode } = genBasicBlocks(fn.body, fn.params.map(p => p.name).concat(fn.name));
    currentFunctionName = null;
    const retLine = `return ${fn.name};`;
    const lines = [retVarDecl];
    if (decls) lines.push(decls);
    lines.push("let mut pc: i32 = 0;");
    lines.push("'pc_loop: loop {");
    lines.push(indent(matchCode));
    lines.push("}");
    lines.push(retLine);
    return `${pub}fn ${fn.name}(${params}) -> ${retType} {\n${indent(lines.join("\n"))}\n}`;
}

function genProcedure(proc) {
    const params = proc.params.map(
        p => `${p.modifiers && p.modifiers.includes("VAR_KEYWORD") ? "mut " : ""}${p.name}: ${rustType(p.type)}`
    ).join(", ");
    const pub = proc.modifiers && proc.modifiers.includes("GLOBAL_KEYWORD") ? "pub " : "";
    currentFunctionName = null;
    const { decls, matchCode } = genBasicBlocks(proc.body, proc.params.map(p => p.name));
    const lines = [];
    if (decls) lines.push(decls);
    lines.push("let mut pc: i32 = 0;");
    lines.push("'pc_loop: loop {");
    lines.push(indent(matchCode));
    lines.push("}");
    return `${pub}fn ${proc.name}(${params}) {\n${indent(lines.join("\n"))}\n}`;
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
        case "MemberExpression":
            return `${genExpr(expr.object)}.${expr.property}`;
        case "IndexExpression":
            return `${genExpr(expr.array)}[(${genExpr(expr.index)}) as usize]`;
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

function collectLabels(block, set = new Set()) {
    for (const stmt of block.statements) {
        if (stmt.type === "LabelStatement") {
            set.add(stmt.label);
        }
        if (stmt.body) collectLabels(stmt.body, set);
        if (stmt.consequent) collectLabels(stmt.consequent, set);
        if (stmt.alternate) collectLabels(stmt.alternate, set);
    }
    return set;
}

function splitIntoBlocks(statements) {
    let blocks = [];
    let current = { label: null, stmts: [] };
    for (const stmt of statements) {
        if (stmt.type === "VarDeclaration") {
            // variable declarations will be emitted before the state machine
            continue;
        }
        if (stmt.type === "LabelStatement") {
            if (current.stmts.length > 0 || current.label !== null) {
                blocks.push(current);
            }
            current = { label: stmt.label, stmts: [] };
        } else {
            current.stmts.push(stmt);
            if (stmt.type === "GotoStatement" || stmt.type === "Return") {
                blocks.push(current);
                current = { label: null, stmts: [] };
            }
        }
    }
    if (current.stmts.length > 0 || current.label !== null) {
        blocks.push(current);
    }
    return blocks;
}

function endsWithJump(stmts) {
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1];
    return last.type === "GotoStatement" || last.type === "Return";
}

function genBasicBlockBody(block, ctx, nextPc) {
    const body = genBlock({ statements: block.stmts }, [], ctx);
    let lines = body ? body.split("\n") : [];
    if (!endsWithJump(block.stmts)) {
        if (nextPc === null) {
            lines.push(`break '${ctx.loopLabel};`);
        } else {
            lines.push(`${ctx.pcVar} = ${nextPc};`);
            lines.push(`continue '${ctx.loopLabel};`);
        }
    }
    return lines.join("\n");
}

function genBasicBlocks(block, paramNames) {
    const blocks = splitIntoBlocks(block.statements);
    const labelMap = new Map();
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].label) {
            labelMap.set(blocks[i].label, i);
        }
    }
    const ctx = { labelMap, pcVar: "pc", loopLabel: "pc_loop" };
    let arms = [];
    for (let i = 0; i < blocks.length; i++) {
        const nextPc = i + 1 < blocks.length ? i + 1 : null;
        const body = genBasicBlockBody(blocks[i], ctx, nextPc);
        arms.push(`${i} => {\n${indent(body)}\n}`);
    }
    arms.push(`_ => break '${ctx.loopLabel}`);
    let decls = [];
    for (const stmt of block.statements) {
        if (stmt.type === "VarDeclaration") {
            decls.push(genBlock({ statements: [stmt] }, paramNames, null));
        }
    }
    const matchCode = `match pc {\n${indent(arms.join(",\n"))}\n}`;
    return { decls: decls.join("\n"), matchCode };
}

module.exports = { genRust };
