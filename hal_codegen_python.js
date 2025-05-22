// hal_codegen_python.js
// Generate Python code from HAL AST. Uses same basic block approach as the Rust generator.

function genPython(ast, builtins = []) {
    let out = [];
    if (builtins.length > 0) {
        const names = Array.from(new Set(
            builtins
                .filter(b => b.type === 'ExternalFunction' || b.type === 'ExternalProcedure')
                .map(b => b.name)
        ));
        if (names.length > 0) {
            out.push('# external declarations: ' + names.join(', '));
        }
    }
    for (const item of ast.items) {
        if (item.type === 'Function') {
            out.push(genFunction(item));
        } else if (item.type === 'Procedure') {
            out.push(genProcedure(item));
        } else if (item.type === 'ExternalFunction' || item.type === 'ExternalProcedure') {
            out.push(`# external ${item.type === 'ExternalFunction' ? 'function' : 'procedure'} ${item.name}`);
        }
    }
    return out.join('\n\n');
}

let currentFunctionName = null;

function genBlock(block, paramNames = [], ctx = null) {
    let code = [];
    for (const stmt of block.statements) {
        if (stmt.type === 'VarDeclaration') {
            for (const name of stmt.names) {
                code.push(`${name} = ${defaultValuePython(stmt.halType)}`);
            }
        } else if (stmt.type === 'Assignment') {
            code.push(`${genExpr(stmt.left)} = ${genExpr(stmt.expr)}`);
        } else if (stmt.type === 'Return') {
            if (stmt.expr) {
                code.push(`return ${genExpr(stmt.expr)}`);
            } else {
                if (currentFunctionName) {
                    code.push(`return ${currentFunctionName}`);
                } else {
                    code.push('return');
                }
            }
        } else if (stmt.type === 'ExpressionStatement') {
            code.push(`${genExpr(stmt.expr)}`);
        } else if (stmt.type === 'GotoStatement') {
            const target = ctx ? ctx.labelMap.get(stmt.label) : null;
            if (ctx && target !== null && target !== undefined) {
                code.push(`${ctx.pcVar} = ${target}`);
                code.push('continue');
            } else {
                code.push(`# goto ${stmt.label}`);
            }
        } else if (stmt.type === 'IfStatement') {
            const cond = genExpr(stmt.condition);
            const thenCode = indent(genBlock(stmt.consequent, [], ctx));
            if (stmt.alternate) {
                const elseCode = indent(genBlock(stmt.alternate, [], ctx));
                code.push(`if ${cond}:\n${thenCode}\nelse:\n${elseCode}`);
            } else {
                code.push(`if ${cond}:\n${thenCode}`);
            }
        } else if (stmt.type === 'WhileStatement') {
            const cond = genExpr(stmt.condition);
            const body = indent(genBlock(stmt.body, [], ctx));
            code.push(`while ${cond}:\n${body}`);
        } else if (stmt.type === 'ForStatement') {
            const initLine = `${genExpr(stmt.init.left)} = ${genExpr(stmt.init.expr)}`;
            const cond = genExpr(stmt.condition);
            const updateLine = `${genExpr(stmt.update.left)} = ${genExpr(stmt.update.expr)}`;
            const body = indent(genBlock(stmt.body, [], ctx));
            code.push(initLine);
            code.push(`while ${cond}:`);
            code.push(indent(body));
            code.push(indent(updateLine));
        } else if (stmt.type === 'SwitchStatement') {
            const disc = genExpr(stmt.discriminant);
            let arms = [];
            for (const cs of stmt.cases) {
                const pat = cs.values.map(v => genExpr(v)).join(', ');
                const body = indent(genBlock({ statements: cs.body }, [], ctx));
                arms.push(`if ${disc} in (${pat}):\n${body}`);
            }
            if (stmt.otherwise && stmt.otherwise.length > 0) {
                const body = indent(genBlock({ statements: stmt.otherwise }, [], ctx));
                arms.push(`else:\n${body}`);
            }
            code.push(arms.join('\n'));
        } else if (stmt.type === 'AsyncCallStatement') {
            const args = stmt.args.map(a => genExpr(a)).join(', ');
            code.push(`# async ${stmt.queue}.${stmt.callee}(${args})`);
        } else if (stmt.type === 'LabelStatement') {
            // labels are handled in basic block splitting
        } else {
            code.push(`# Unhandled statement: ${stmt.type}`);
        }
    }
    return code.join('\n');
}

function defaultValuePython(halType) {
    let base = typeof halType === 'object' ? halType.base : halType;
    switch ((base || '').toLowerCase()) {
        case 'integer':
        case 'longint':
        case 'val':
            return '0';
        case 'boolean':
            return 'False';
        case 'string':
            return "''";
        case 'array':
            return '[]';
        default:
            return 'None';
    }
}

function genFunction(fn) {
    const params = fn.params.map(p => p.name).join(', ');
    const retVarDecl = `${fn.name} = ${defaultValuePython(fn.returnType)}`;
    currentFunctionName = fn.name;
    const { decls, matchCode } = genBasicBlocks(fn.body, fn.params.map(p => p.name).concat(fn.name));
    currentFunctionName = null;
    const retLine = `return ${fn.name}`;
    let lines = [];
    lines.push(retVarDecl);
    if (decls) lines.push(decls);
    lines.push('pc = 0');
    lines.push('while True:');
    lines.push(indent(matchCode));
    lines.push(retLine);
    return `def ${fn.name}(${params}):\n${indent(lines.join('\n'))}`;
}

function genProcedure(proc) {
    const params = proc.params.map(p => p.name).join(', ');
    const { decls, matchCode } = genBasicBlocks(proc.body, proc.params.map(p => p.name));
    let lines = [];
    if (decls) lines.push(decls);
    lines.push('pc = 0');
    lines.push('while True:');
    lines.push(indent(matchCode));
    return `def ${proc.name}(${params}):\n${indent(lines.join('\n'))}`;
}

function genExpr(expr) {
    switch (expr.type) {
        case 'Identifier':      return expr.name;
        case 'NumberLiteral':   return expr.value.toString();
        case 'StringLiteral':   return JSON.stringify(expr.value);
        case 'BooleanLiteral':  return expr.value ? 'True' : 'False';
        case 'BinaryExpression':
            if (expr.operator === 'AMPERSAND') {
                return `${genExpr(expr.left)} + ${genExpr(expr.right)}`;
            }
            return `${genExpr(expr.left)} ${opPython(expr.operator)} ${genExpr(expr.right)}`;
        case 'UnaryExpression':
            return `${opPython(expr.operator)}${genExpr(expr.argument)}`;
        case 'CallExpression':
            switch (expr.callee.toLowerCase()) {
                case 'logtext': {
                    const indentArg = genExpr(expr.args[0]);
                    const textArg = genExpr(expr.args[1]);
                    return `print(' ' * (${indentArg}) + ${textArg})`;
                }
                default:
                    return `${expr.callee}(${expr.args.map(a => genExpr(a)).join(', ')})`;
            }
        case 'MemberExpression':
            return `${genExpr(expr.object)}.${expr.property}`;
        case 'IndexExpression':
            return `${genExpr(expr.array)}[${genExpr(expr.index)}]`;
        case 'ParenExpression':
            return `(${genExpr(expr.expr)})`;
        default:
            return 'None';
    }
}

function opPython(op) {
    switch (op) {
        case 'PLUS':  return '+';
        case 'MINUS': return '-';
        case 'MULTIPLY': return '*';
        case 'DIVIDE': return '/';
        case 'LESS': return '<';
        case 'LESS_OR_EQUAL': return '<=';
        case 'GREATER': return '>';
        case 'GREATER_OR_EQUAL': return '>=';
        case 'EQEQ': return '==';
        case 'NOT_EQUALS': return '!=';
        case 'AND_KEYWORD': return 'and';
        case 'OR_KEYWORD': return 'or';
        case 'NOT_KEYWORD': return 'not ';
        case 'NOT_OP': return 'not ';
        default: return op;
    }
}

function indent(str, prefix = '    ') {
    return str.split('\n').map(line => prefix + line).join('\n');
}

function splitIntoBlocks(statements) {
    let blocks = [];
    let current = { label: null, stmts: [] };
    for (const stmt of statements) {
        if (stmt.type === 'VarDeclaration') {
            continue;
        }
        if (stmt.type === 'LabelStatement') {
            if (current.stmts.length > 0 || current.label !== null) {
                blocks.push(current);
            }
            current = { label: stmt.label, stmts: [] };
        } else {
            current.stmts.push(stmt);
            if (stmt.type === 'GotoStatement' || stmt.type === 'Return') {
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
    return last.type === 'GotoStatement' || last.type === 'Return';
}

function genBasicBlockBody(block, ctx, nextPc) {
    const body = genBlock({ statements: block.stmts }, [], ctx);
    let lines = body ? body.split('\n') : [];
    if (!endsWithJump(block.stmts)) {
        if (nextPc === null) {
            lines.push('break');
        } else {
            lines.push(`${ctx.pcVar} = ${nextPc}`);
            lines.push('continue');
        }
    }
    return lines.join('\n');
}

function genBasicBlocks(block, paramNames) {
    const blocks = splitIntoBlocks(block.statements);
    const labelMap = new Map();
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].label) {
            labelMap.set(blocks[i].label, i);
        }
    }
    const ctx = { labelMap, pcVar: 'pc' };
    let arms = [];
    for (let i = 0; i < blocks.length; i++) {
        const nextPc = i + 1 < blocks.length ? i + 1 : null;
        const body = genBasicBlockBody(blocks[i], ctx, nextPc);
        arms.push(`if pc == ${i}:\n${indent(body)}`);
    }
    arms.push('else:\n        break');
    let decls = [];
    for (const stmt of block.statements) {
        if (stmt.type === 'VarDeclaration') {
            decls.push(genBlock({ statements: [stmt] }, paramNames, null));
        }
    }
    const matchCode = arms.join('\n');
    return { decls: decls.join('\n'), matchCode };
}

module.exports = { genPython };
