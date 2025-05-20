// hal_parser.js
const { lex } = require('./hal_lexer');

class ParseError extends Error {
    constructor(message, token) {
        super(`${message} at line ${token.line}, column ${token.col}`);
        this.token = token;
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
    // Program ::= (subprogram | data_structure | ...)*
    parseProgram() {
        const items = [];
        while (this.peek().type !== "EOF") {
            if (this.peek().type === "FUNCTION_KEYWORD") {
                items.push(this.parseFunction());
            } else if (this.peek().type === "PROCEDURE_KEYWORD") {
                items.push(this.parseProcedure());
            } else {
                // TODO: Add more parse entry points
                this.pos++; // skip unknown
            }
        }
        return { type: "Program", items };
    }
    parseFunction() {
        this.expect("FUNCTION_KEYWORD");
        let typeToken = this.peek();
        // Only accept explicit type tokens (INTEGER_TYPE, STRING_TYPE, etc.)
        if (!typeToken.type.endsWith("_TYPE") && typeToken.type !== "TIME_KEYWORD" && typeToken.type !== "ROW_KEYWORD" && typeToken.type !== "RECORD_KEYWORD") {
            throw new ParseError(
                `Expected type after 'function', but got ${typeToken.type} ('${typeToken.value}')`,
                typeToken
            );
        }
        let type = this.expect(typeToken.type).value;
        let nameToken = this.expect("IDENTIFIER");
        let name = nameToken.value;
        this.expect("LPAREN");
        const params = this.parseParamList();
        this.expect("RPAREN");
        const body = this.parseBlock();
        return {
            type: "Function",
            name,
            returnType: type,
            params,
            body,
            span: {
                start: { line: typeToken.line, col: typeToken.col },
                end: { line: body.span?.end.line || body.endLine, col: body.span?.end.col || body.endCol }
            }
        };
    }
    parseProcedure() {
        this.expect("PROCEDURE_KEYWORD");
        const name = this.expect("IDENTIFIER").value;
        this.expect("LPAREN");
        const params = this.parseParamList();
        this.expect("RPAREN");
        const body = this.parseBlock();
        return { type: "Procedure", name, params, body };
    }
    parseParamList() {
        const params = [];
        while (
            this.peek().type !== "RPAREN" &&
            this.peek().type !== "EOF"
        ) {
            // type then name
            let typeTok = this.peek();
            if (
                typeTok.type.endsWith("_TYPE") ||
                typeTok.type === "IDENTIFIER"
            ) {
                let type = this.expect(typeTok.type).value;
                let nameTok = this.expect("IDENTIFIER");
                params.push({
                    type,
                    name: nameTok.value,
                    span: {
                        start: { line: typeTok.line, col: typeTok.col },
                        end: { line: nameTok.endLine, col: nameTok.endCol }
                    }
                });
            } else {
                // Unknown type: helpful error
                throw new ParseError(
                    `Unknown type: ${typeTok.value}`,
                    typeTok
                );
            }
            if (!this.accept("COMMA")) break;
        }
        return params;
    }
    parseBlock() {
        this.expect("BEGIN_KEYWORD");
        let statements = [];
        while (this.peek().type !== "END_KEYWORD" && this.peek().type !== "EOF") {
            statements.push(this.parseStatement());
        }
        this.expect("END_KEYWORD");
        this.accept("SEMICOLON");
        return { type: "Block", statements };
    }
    parseStatement() {
        // Simple assignment/return/expression
        if (this.peek().type === "IDENTIFIER" && this.peek(1).type === "EQUALS") {
            let left = this.expect("IDENTIFIER").value;
            this.expect("EQUALS");
            let expr = this.parseExpression();
            this.accept("SEMICOLON");
            return { type: "Assignment", left, expr };
        } else if (this.peek().type === "RETURN_KEYWORD") {
            this.expect("RETURN_KEYWORD");
            let expr = this.parseExpression();
            this.accept("SEMICOLON");
            return { type: "Return", expr };
        } else {
            let expr = this.parseExpression();
            this.accept("SEMICOLON");
            return { type: "ExpressionStatement", expr };
        }
    }
    parseExpression() {
        return this.parseAdditive();
    }

    parseAdditive() {
        let node = this.parsePrimary();
        while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
            let op = this.expect(this.peek().type).type;
            let right = this.parsePrimary();
            node = { type: "BinaryExpression", operator: op, left: node, right };
        }
        return node;
    }

    parsePrimary() {
        let t = this.peek();
        if (t.type === "IDENTIFIER") {
            return { type: "Identifier", name: this.expect("IDENTIFIER").value };
        }
        if (t.type === "NUMBER") {
            return { type: "NumberLiteral", value: Number(this.expect("NUMBER").value) };
        }
        if (t.type === "STRING_LITERAL") {
            return { type: "StringLiteral", value: this.expect("STRING_LITERAL").value };
        }
        throw new Error(`Unexpected token in expression: ${t.type}`);
    }
}

function parse(input) {
    const tokens = lex(input);
    const parser = new Parser(tokens);
    return parser.parseProgram();
}

module.exports = { parse, ParseError };
