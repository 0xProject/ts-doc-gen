import { logUtils, promisify } from '@0x/utils';
import * as fs from 'fs';
import * as glob from 'glob';
import { exec as execAsync } from 'promisify-child-process';
import * as rimraf from 'rimraf';
import * as yargs from 'yargs';

const rimrafAsync = promisify(rimraf);
const globAsync = promisify(glob);

(async () => {

    const args = yargs
    .option('sourceDir', {
        alias: ['s', 'src'],
        describe: 'Folder where the source TS files are located',
        type: 'string',
        normalize: true,
        demandOption: true,
    })
    .option('output', {
        alias: ['o', 'out'],
        describe: 'Folder where to put the output doc files',
        type: 'string',
        normalize: true,
        demandOption: true,
    })
    .option('tsconfig', {
        describe: 'A custom tsconfig to use with TypeDoc',
        type: 'string',
        normalize: true,
        demandOption: false,
        default: undefined,
    })
    .option('fileExtension', {
        describe: 'The file extension you want the reference markdown written to',
        type: 'string',
        normalize: true,
        demandOption: false,
        default: 'md',
    })
    .example(
        "$0 --src 'src' --out 'docs'",
        'Full usage example',
    ).argv;

    await rimrafAsync(args.output);
    let typedocArgs = `--theme markdown --platform gitbook --ignoreCompilerErrors --excludePrivate --excludeProtected --excludeExternals --excludeNotExported --target ES5 --module commonjs --hideGenerator --out ${args.output} ${args.sourceDir}`;
    if (args.tsconfig !== undefined) {
        typedocArgs = `--tsconfig ${args.tsconfig} ${typedocArgs}`;
    }
    try {
        await execAsync(`./node_modules/typedoc/bin/typedoc ${typedocArgs}`);
    } catch (err) {
        // It might fail because we're in a hoisted lerna workspace, so try calling it via the `.bin` file
        try {
            await execAsync(`./node_modules/.bin/typedoc ${typedocArgs}`);
        } catch (err) {
            // If that fails too, something went wrong
            logUtils.log('typedoc command failed: ', err);
            process.exit(1);
        }
    }

    // Concat all TS Client MD files together into a single reference doc
    const referencePath = `${args.output}/reference.${args.fileExtension}`;
    await rimrafAsync(referencePath);
    const paths = await globAsync(`${args.output}/**/*`) as string[];

    (paths as any).sort((firstEl: string, secondEl: string) => {
            const isFirstAFile = firstEl.includes('.md');
            const isSecondAFile = secondEl.includes('.md');
            if ((isFirstAFile && isSecondAFile) || (!isFirstAFile && !isSecondAFile)) {
                return 0;
            }
            if (isFirstAFile) {
                return -1;
            }
            if (isSecondAFile) {
                return 1;
            }
            return undefined;
        });
    for (const path of paths) {
            if (path.includes('.md', 1)) {
                if (!path.includes('README.md', 1) && !path.includes('SUMMARY.md', 1) && !path.includes('globals.md', 1)) {
                    // Read file content and concat to new file
                    const content = fs.readFileSync(path);
                    fs.appendFileSync(referencePath, content);
                    fs.appendFileSync(referencePath, '\n');
                    fs.appendFileSync(referencePath, '\n');
                    fs.appendFileSync(referencePath, '<hr />');
                    fs.appendFileSync(referencePath, '\n');
                    fs.appendFileSync(referencePath, '\n');
                }
                if (!path.includes('README.md', 1)) {
                    fs.unlinkSync(path);
                }
            } else {
                fs.rmdirSync(path);
            }
        }

    // Find/replace relative links with hash links
    const docsBuff = fs.readFileSync(referencePath);
    let docs = docsBuff.toString();
    docs = docs.replace(/\]\(((?!.*(github.com|\]\()).*)(#.*\))/g, ']($3');
    docs = docs.replace(/\]\(..\/interfaces\/.*?\.(.*?)\.md\)/g, '](#interface-$1)');
    docs = docs.replace(/\]\(..\/classes\/.*?\.(.*?)\.md\)/g, '](#class-$1)');
    docs = docs.replace(/\]\(..\/enums\/.*?\.(.*?)\.md\)/g, '](#enumeration-$1)');
    docs = docs.replace(/(Inherited from.*\]\().*?\.(.*?)\.md\)/g, '$1#interface-$2)');
    docs = docs.replace(/\]\(..\/modules\/.*?\.md/g, '](');
    docs = docs.replace(/\]\(_types_\.(.*?)\.md\)/g, '](#interface-$1)');
    docs = docs.replace(/\]\((?!.*(\]\()).*\.(.*?)\.md\)/g, '](#class-$2)');
    // Remove "Defined in" when it's referencing an absolute path
    docs = docs.replace(/Defined in \/.*/g, '');
    // Remove "Inherited from void"
    docs = docs.replace(/\*Inherited from void\*/g, '');
    // Get rid of `>` before H1s
    docs = docs.replace(/> #/g, '#');
    // Deliberate rename "constructor" to "the constructor" b/c of website issues with
    // header id named "constructor"
    docs = docs.replace(/###  constructor/gm, '');
    docs = docs.replace(/(.*)# External module:(.*)/g, '');
                // Get rid on "Index" section with overview links
    docs = docs.replace(/## Index[\s\S]*?^(\n## |<hr \/>)/gm, '$1 ');
    docs = docs.replace(/##( |  )Hierarchy[\s\S]*?^(\n## )/gm, '$2 ');

    // Reduce the methods under an object literal to H4 instead of also H3
    const updatedLines = [];
    const lines = docs.split('\n');
    let isInObjectLiteral = false;
    for (const line of lines) {
        if (line.includes('### ▪ **')) {
            isInObjectLiteral = true;
        }
        if (line.includes('___')) {
            isInObjectLiteral = false;
        }
        if (isInObjectLiteral && line.includes('###')) {
            updatedLines.push(`#${line}`);
        } else {
            updatedLines.push(line);
        }
    }
    docs = updatedLines.join('\n');

    fs.writeFileSync(referencePath, docs);
    logUtils.log('TS doc generation complete!');
    process.exit(0);
})().catch(err => {
    logUtils.log(err);
    process.exit(1);
});
