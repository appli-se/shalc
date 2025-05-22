function hasLabelOrGoto(block) {
    for (const stmt of block.statements) {
        switch (stmt.type) {
            case 'LabelStatement':
            case 'GotoStatement':
                return true;
            case 'IfStatement':
                if (hasLabelOrGoto(stmt.consequent)) return true;
                if (stmt.alternate && hasLabelOrGoto(stmt.alternate)) return true;
                break;
            case 'WhileStatement':
            case 'ForStatement':
                if (hasLabelOrGoto(stmt.body)) return true;
                break;
            case 'SwitchStatement':
                for (const cs of stmt.cases) {
                    if (hasLabelOrGoto({ statements: cs.body })) return true;
                }
                if (stmt.otherwise && hasLabelOrGoto({ statements: stmt.otherwise })) return true;
                break;
            default:
                break;
        }
    }
    return false;
}

function isSimpleBlock(block) {
    return block.statements.every(s =>
        s.type === 'VarDeclaration' ||
        s.type === 'Assignment' ||
        s.type === 'Return');
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function substituteExpr(expr, env) {
    switch (expr.type) {
        case 'Identifier':
            return env.has(expr.name) ? clone(env.get(expr.name)) : clone(expr);
        case 'BinaryExpression':
            return {
                type: 'BinaryExpression',
                operator: expr.operator,
                left: substituteExpr(expr.left, env),
                right: substituteExpr(expr.right, env)
            };
        case 'UnaryExpression':
            return {
                type: 'UnaryExpression',
                operator: expr.operator,
                argument: substituteExpr(expr.argument, env)
            };
        case 'ParenExpression':
            return { type: 'ParenExpression', expr: substituteExpr(expr.expr, env) };
        default:
            return clone(expr);
    }
}

function optimizeSimpleBlock(block, returnName) {
    const env = new Map();
    const out = [];
    for (const stmt of block.statements) {
        if (stmt.type === 'VarDeclaration') {
            continue; // drop
        } else if (stmt.type === 'Assignment') {
            if (stmt.left.type === 'Identifier') {
                env.set(stmt.left.name, substituteExpr(stmt.expr, env));
            } else {
                out.push({
                    type: 'Assignment',
                    left: substituteExpr(stmt.left, env),
                    expr: substituteExpr(stmt.expr, env)
                });
            }
        } else if (stmt.type === 'Return') {
            let expr = stmt.expr ? substituteExpr(stmt.expr, env) : null;
            if (!expr && env.has(returnName)) {
                expr = substituteExpr(env.get(returnName), env);
            }
            out.push({ type: 'Return', expr });
        }
    }
    return { type: 'Block', statements: out };
}

function removeDeadCode(ast) {
    const newItems = [];
    for (const item of ast.items) {
        if ((item.type === 'Function' || item.type === 'Procedure')) {
            if (!item.modifiers || !item.modifiers.includes('GLOBAL_KEYWORD')) {
                continue; // drop non-global
            }
            if (!hasLabelOrGoto(item.body) && isSimpleBlock(item.body)) {
                item.body = optimizeSimpleBlock(item.body, item.type === 'Function' ? item.name : null);
            }
            newItems.push(item);
        }
    }
    return { type: 'Program', items: newItems };
}

module.exports = { removeDeadCode, hasLabelOrGoto };
