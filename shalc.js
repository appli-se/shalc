const fs = require('fs');
const path = require('path');
const { parse, ParseError } = require('./hal_parser');
const { genRust } = require('./hal_codegen_rust');

function usage() {
    console.error('Usage: node shalc.js <file.hal>');
    process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath || !inputPath.endsWith('.hal')) {
    usage();
}

let code;
try {
    code = fs.readFileSync(inputPath, 'utf8');
} catch (e) {
    console.error(`Could not read file: ${inputPath}`);
    process.exit(1);
}

let ast;
try {
    ast = parse(code);
} catch (e) {
    if (e instanceof ParseError) {
        console.error(e.message);
        process.exit(1);
    } else {
        throw e;
    }
}

const rust = genRust(ast) + "\n";
const outPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath, '.hal') + '.rs'
);

try {
    fs.writeFileSync(outPath, rust);
    console.log(`Written ${outPath}`);
} catch (e) {
    console.error(`Failed to write output: ${outPath}`);
    process.exit(1);
}
