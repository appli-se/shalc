// hal_parser.js
// based on:
// https://gitlab.appli.se/appli/playground/intellij-hal/-/blob/master/src/main/grammar/HAL.bnf?ref_type=heads
const { lex } = require('./hal_lexer');

class ParseError extends Error {
    constructor(message, token) {
        super(`${message} at line ${token.line}, column ${token.col}`);
        this.token = token;
    }
}

// A classic lexical symbol table (block-scoped)
class SymbolTable {
    constructor(parent = null) {
        this.parent = parent;
        this.table = new Map();
    }
    declare(name, info) {
        if (this.table.has(name)) {
            throw new Error(`Variable '${name}' is already declared in this scope`);
        }
        this.table.set(name, info);
    }
    lookup(name) {
        if (this.table.has(name)) return this.table.get(name);
        if (this.parent) return this.parent.lookup(name);
        return null;
    }
}

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    peek(offset = 0) {
        return this.tokens[this.pos + offset];
    }
    expect(type) {
        let token = this.peek();
        if (token.type !== type) {
            throw new ParseError(
                `Expected ${type} but got ${token.type} ('${token.value}')`,
                token
            );
        }
        this.pos++;
        return token;
    }
    accept(type) {
        if (this.peek().type === type) {
            return this.tokens[this.pos++];
        }
        return null;
    }

    isTypeToken(token) {
        return (
            token.type.endsWith('_TYPE') ||
            token.type === 'TIME_KEYWORD' ||
            token.type === 'ROW_KEYWORD' ||
            token.type === 'RECORD_KEYWORD'
        );
    }

    parseProgram() {
        const items = [];
        while (this.peek().type !== "EOF") {
            const item = this.parseItem();
            if (item) items.push(item);
        }
        return { type: "Program", items };
    }

    parseItem() {
        // Collect all leading modifiers (as long as they are allowed keywords)
        const modifiers = [];
        while ([
            "GLOBAL_KEYWORD",
            "EXTERNAL_KEYWORD",
            "UPDATING_KEYWORD",
            "INNER_KEYWORD",
            "REMOTE_KEYWORD",
            "OUTER_KEYWORD",
        ].includes(this.peek().type)) {
            modifiers.push(this.expect(this.peek().type).type);
        }

        if (this.peek().type === "FUNCTION_KEYWORD") {
            return this.parseFunctionOrExternal(modifiers);
        } else if (this.peek().type === "PROCEDURE_KEYWORD") {
            return this.parseProcedureOrExternal(modifiers);
        }

        // Not a recognized declaration, skip or throw (based on your error handling policy)
        this.pos++;
        return null;
    }

    parseFunctionOrExternal(modifiers = []) {
        this.expect("FUNCTION_KEYWORD");
        let returnType = null;
        if (this.isTypeToken(this.peek())) {
            returnType = this.expect(this.peek().type).value;
        }
        let nameToken = this.expect("IDENTIFIER");
        let name = nameToken.value;
        let params = [];
        if (this.accept("LPAREN")) {
            params = this.parseParamList(modifiers.indexOf("EXTERNAL_KEYWORD") === -1);
            this.expect("RPAREN");
        }
        const isExternal = modifiers.includes("EXTERNAL_KEYWORD");
        const hasBody = this.peek().type === "BEGIN_KEYWORD";

        if (isExternal && modifiers.includes("GLOBAL_KEYWORD")) {
            throw new ParseError("external cannot be combined with global", this.peek(-1));
        }

        if (isExternal) {
            if (hasBody) {
                throw new ParseError("external function cannot have a body", this.peek());
            }
            this.accept("SEMICOLON");
            return { type: "ExternalFunction", name, returnType, params, modifiers };
        } else {
            if (!hasBody) {
                throw new ParseError("function definition requires a body", this.peek());
            }
            if (params.some(p => p.name === null)) {
                throw new ParseError("function parameters must have names", this.peek());
            }
            let body = this.parseBlock(params.map(p => p.name), null);
            return { type: "Function", name, returnType, params, body, modifiers };
        }
    }

    parseFunction(modifiers = []) {
        // deprecated: kept for compatibility, now calls parseFunctionOrExternal
        return this.parseFunctionOrExternal(modifiers);
    }

    parseProcedureOrExternal(modifiers = []) {
        this.expect("PROCEDURE_KEYWORD");
        let nameToken = this.expect("IDENTIFIER");
        let name = nameToken.value;
        let params = [];
        if (this.accept("LPAREN")) {
            params = this.parseParamList(modifiers.indexOf("EXTERNAL_KEYWORD") === -1);
            this.expect("RPAREN");
        }
        const isExternal = modifiers.includes("EXTERNAL_KEYWORD");
        const hasBody = this.peek().type === "BEGIN_KEYWORD";

        if (isExternal && modifiers.includes("GLOBAL_KEYWORD")) {
            throw new ParseError("external cannot be combined with global", this.peek(-1));
        }

        if (isExternal) {
            if (hasBody) {
                throw new ParseError("external procedure cannot have a body", this.peek());
            }
            this.accept("SEMICOLON");
            return { type: "ExternalProcedure", name, params, modifiers };
        } else {
            if (!hasBody) {
                throw new ParseError("procedure definition requires a body", this.peek());
            }
            if (params.some(p => p.name === null)) {
                throw new ParseError("procedure parameters must have names", this.peek());
            }
            let body = this.parseBlock(params.map(p => p.name), null);
            return { type: "Procedure", name, params, body, modifiers };
        }
    }

    parseProcedure(modifiers = []) {
        // deprecated: kept for compatibility
        return this.parseProcedureOrExternal(modifiers);
    }

    parseParamList(requireNames = false) {
        const params = [];
        while (
            this.peek().type !== "RPAREN" &&
            this.peek().type !== "EOF"
        ) {
            const modifiers = [];
            while (this.peek().type === "VAR_KEYWORD" || this.peek().type === "ARRAY_KEYWORD") {
                modifiers.push(this.expect(this.peek().type).type);
            }

            let type = this.parseType(false);

            let name = null;
            if (this.peek().type === "IDENTIFIER") {
                name = this.expect("IDENTIFIER").value;
            } else if (requireNames) {
                throw new ParseError("Parameter name required", this.peek());
            }

            params.push({ type, name, modifiers });
            if (!this.accept("COMMA")) break;
        }
        return params;
    }

    parseBlock(paramNames = [], parentTable = null) {
        this.expect("BEGIN_KEYWORD");
        const symbolTable = new SymbolTable(parentTable);
        // Parameters are "declared" in the symbol table
        for (let name of paramNames) {
            symbolTable.declare(name, { halType: "parameter" });
        }
        let statements = [];
        while (this.peek().type !== "END_KEYWORD" && this.peek().type !== "EOF") {
            let stmt = this.parseStatementWithSymbols(symbolTable);
            statements.push(stmt);
        }
        this.expect("END_KEYWORD");
        this.accept("SEMICOLON");
        return { type: "Block", statements, symbolTable };
    }

    parseStatementWithSymbols(symbolTable) {
        // Local variable declaration: <type> <id>[, <id>]* ;
        if (this.isTypeToken(this.peek())) {
            let decl = this.parseLocalVariableDeclaration();
            for (let name of decl.names) {
                symbolTable.declare(name, { halType: decl.halType });
            }
            return decl;
        }
        // Assignment: <id> = <expr> ;
        if (this.peek().type === "IDENTIFIER" && this.peek(1).type === "EQUALS") {
            const assign = this.parseAssignmentExpr(symbolTable);
            this.accept("SEMICOLON");
            return assign;
        }
        // Return statement
        if (this.peek().type === "RETURN_KEYWORD") {
            this.expect("RETURN_KEYWORD");
            let expr = null;
            if (this.peek().type !== "SEMICOLON") {
                expr = this.parseExpressionWithSymbols(symbolTable);
            }
            this.accept("SEMICOLON");
            return { type: "Return", expr };
        }
        // If statement
        if (this.peek().type === "IF_KEYWORD") {
            return this.parseIf(symbolTable);
        }
        // While loop
        if (this.peek().type === "WHILE_KEYWORD") {
            return this.parseWhile(symbolTable);
        }
        // For loop
        if (this.peek().type === "FOR_KEYWORD") {
            return this.parseFor(symbolTable);
        }
        // Expression statement (like a function call)
        let expr = this.parseExpressionWithSymbols(symbolTable);
        this.accept("SEMICOLON");
        return { type: "ExpressionStatement", expr };
    }

    parseType(requireLengthForString = false) {
        let token = this.peek();
        if (!this.isTypeToken(token)) {
            throw new ParseError(`Expected type but got ${token.type}`, token);
        }
        let base = this.expect(token.type).value;
        let length = null;
        if (base.toLowerCase() === "string") {
            if (this.peek().type === "NUMBER") {
                length = Number(this.expect("NUMBER").value);
            } else if (requireLengthForString) {
                throw new ParseError("string definition requires length", this.peek());
            }
        }
        return { base, length };
    }

    parseLocalVariableDeclaration() {
        let halType = this.parseType(true);
        let ids = [this.expect("IDENTIFIER").value];
        while (this.accept("COMMA")) {
            ids.push(this.expect("IDENTIFIER").value);
        }
        this.expect("SEMICOLON");
        return {
            type: "VarDeclaration",
            halType,
            names: ids
        };
    }

    parseIf(symbolTable) {
        this.expect("IF_KEYWORD");
        const condition = this.parseExpressionWithSymbols(symbolTable);
        this.accept("THEN_KEYWORD");
        const consequent = this.parseBlock([], symbolTable);
        let alternate = null;
        if (this.peek().type === "ELSE_KEYWORD") {
            this.expect("ELSE_KEYWORD");
            alternate = this.parseBlock([], symbolTable);
        }
        return { type: "IfStatement", condition, consequent, alternate };
    }

    parseWhile(symbolTable) {
        this.expect("WHILE_KEYWORD");
        const condition = this.parseExpressionWithSymbols(symbolTable);
        const body = this.parseBlock([], symbolTable);
        return { type: "WhileStatement", condition, body };
    }

    parseFor(symbolTable) {
        this.expect("FOR_KEYWORD");
        this.expect("LPAREN");
        const init = this.parseAssignmentExpr(symbolTable);
        this.expect("SEMICOLON");
        const condition = this.parseExpressionWithSymbols(symbolTable);
        this.expect("SEMICOLON");
        const update = this.parseAssignmentExpr(symbolTable);
        this.expect("RPAREN");
        const body = this.parseBlock([], symbolTable);
        return { type: "ForStatement", init, condition, update, body };
    }

    parseAssignmentExpr(symbolTable) {
        const left = this.expect("IDENTIFIER");
        if (!symbolTable.lookup(left.value)) {
            throw new ParseError(`Variable '${left.value}' is not declared`, left);
        }
        this.expect("EQUALS");
        const expr = this.parseExpressionWithSymbols(symbolTable);
        return { type: "Assignment", left: left.value, expr };
    }

    parseExpressionWithSymbols(symbolTable) {
        let node = this.parseAdditiveExpression(symbolTable);
        while ([
            "LESS", "LESS_OR_EQUAL", "GREATER", "GREATER_OR_EQUAL",
            "EQEQ", "NOT_EQUALS"
        ].includes(this.peek().type)) {
            let op = this.expect(this.peek().type).type;
            let right = this.parseAdditiveExpression(symbolTable);
            node = { type: "BinaryExpression", operator: op, left: node, right };
        }
        return node;
    }

    parseAdditiveExpression(symbolTable) {
        let node = this.parsePrimaryWithSymbols(symbolTable);
        while (["PLUS", "MINUS", "AMPERSAND"].includes(this.peek().type)) {
            let op = this.expect(this.peek().type).type;
            let right = this.parsePrimaryWithSymbols(symbolTable);
            node = { type: "BinaryExpression", operator: op, left: node, right };
        }
        return node;
    }

    parsePrimaryWithSymbols(symbolTable) {
        let t = this.peek();
        if (t.type === "LPAREN") {
            this.expect("LPAREN");
            const expr = this.parseExpressionWithSymbols(symbolTable);
            this.expect("RPAREN");
            return { type: "ParenExpression", expr };
        }
        if (t.type === "IDENTIFIER") {
            let id = this.expect("IDENTIFIER");
            if (this.peek().type === "LPAREN") {
                this.expect("LPAREN");
                const args = [];
                if (this.peek().type !== "RPAREN") {
                    args.push(this.parseExpressionWithSymbols(symbolTable));
                    while (this.accept("COMMA")) {
                        args.push(this.parseExpressionWithSymbols(symbolTable));
                    }
                }
                this.expect("RPAREN");
                return { type: "CallExpression", callee: id.value, args };
            } else {
                if (!symbolTable.lookup(id.value)) {
                    throw new ParseError(`Variable '${id.value}' is not declared`, id);
                }
                return { type: "Identifier", name: id.value };
            }
        }
        if (t.type === "NUMBER") {
            return { type: "NumberLiteral", value: Number(this.expect("NUMBER").value) };
        }
        if (t.type === "STRING_LITERAL") {
            let raw = this.expect("STRING_LITERAL").value;
            let content = raw.slice(1, -1);
            return { type: "StringLiteral", value: content };
        }
        throw new ParseError(`Unexpected token in expression: ${t.type}`, t);
    }
}

function parse(input) {
    const tokens = lex(input);
    const parser = new Parser(tokens);
    return parser.parseProgram();
}

module.exports = { parse, ParseError };
