// hal_lexer.js
const tokenSpecs = [
    // White space (skipped)
    { type: "WHITE_SPACE", regex: /^[ \t\f\r\n]+/, skip: true },
    // Comments
    { type: "COMMENT", regex: /^\/\/.*|^\/\*(.|\n)*?\*\//, skip: true },
    // CRLF
    { type: "CRLF", regex: /^(\r\n|\r|\n)+/ },
    // Keywords (longest first)
    ...[
      "otherwise", "procedure", "function", "external", "updating", "global", "begin", "end", "if", "then", "else", "for", "while", "repeat", "goto",
      "var", "array", "record", "row", "of", "return", "switch", "case", "const", "true", "false", "null", "window", "remote", "inner", "outer", "and", "or", "not"
    ].map(kw => ({ type: kw.toUpperCase() + "_KEYWORD", regex: new RegExp("^" + kw + "\\b", "i") })),
    // Types
    ...[
      "area", "boolean", "integer", "longint", "string", "val", "ulong64", "date", "time", "roundmode"
    ].map(kw => ({ type: kw.toUpperCase() + "_TYPE", regex: new RegExp("^" + kw + "\\b", "i") })),
    // Literals
    { type: "STRING_LITERAL", regex: /^('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*")/ },
    { type: "NUMBER", regex: /^[0-9]+(\.[0-9]*)?/ },
    // Identifiers
    { type: "IDENTIFIER", regex: /^[A-Za-z_][A-Za-z0-9_]*/ },
    // Operators and punctuation
    { type: "EQEQ", regex: /^==/ },
    { type: "NOT_EQUALS", regex: /^<>|^!=/ },
    { type: "LESS_OR_EQUAL", regex: /^<=/ },
    { type: "GREATER_OR_EQUAL", regex: /^>=/ },
    { type: "PLUS", regex: /^\+/ },
    { type: "MINUS", regex: /^-/ },
    { type: "MULTIPLY", regex: /^\*/ },
    { type: "DIVIDE", regex: /^\// },
    { type: "EQUALS", regex: /^=/ },
    { type: "LESS", regex: /^</ },
    { type: "GREATER", regex: /^>/ },
    { type: "LPAREN", regex: /^\(/ },
    { type: "RPAREN", regex: /^\)/ },
    { type: "LBRACKET", regex: /^\[/ },
    { type: "RBRACKET", regex: /^\]/ },
    { type: "DOT", regex: /^\./ },
    { type: "COMMA", regex: /^,/ },
    { type: "COLON", regex: /^:/ },
    { type: "SEMICOLON", regex: /^;/ },
    { type: "AMPERSAND", regex: /^&/ },
    { type: "NOT_OP", regex: /^!/ },
    // Fallback
];

function lex(input) {
    let tokens = [];
    let pos = 0, line = 1, col = 1;

    function updatePos(str, matched) {
        for (let i = 0; i < matched.length; i++) {
            if (matched[i] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        return { line, col };
    }

    while (pos < input.length) {
        let match = null;
        for (let spec of tokenSpecs) {
            match = spec.regex.exec(input.slice(pos));
            if (match) {
                let startLine = line, startCol = col;
                let matched = match[0];
                ({ line, col } = updatePos(input.slice(pos, pos + matched.length), matched));
                if (!spec.skip) {
                    tokens.push({
                        type: spec.type,
                        value: matched,
                        pos,
                        line: startLine,
                        col: startCol,
                        endLine: line,
                        endCol: col,
                    });
                }
                pos += matched.length;
                break;
            }
        }
        if (!match) {
            throw new Error(`Unexpected token at line ${line}, column ${col}: "${input.slice(pos, pos + 20)}"`);
        }
    }
    tokens.push({ type: "EOF", value: "", pos, line, col, endLine: line, endCol: col });
    return tokens;
}

module.exports = { lex };
