import * as stylefmt from "stylefmt";
import * as postcss from "postcss";
import * as postcssScss from "postcss-scss";
import { writeFileSync } from "fs";
import { Logger, Timer, fileSystem } from "@speedy/node-core";
import { lint, LinterResult, formatters, LinterOptions } from "stylelint";

import { Worker, args, getConfigFilePath } from "../../utils";
import { LintSassOptions } from "./lint-sass.model";
import { ARGS } from "./lint-sass.args";

const logger = new Logger("Lint SASS");

export async function lintSass(options?: Partial<LintSassOptions>): Promise<LinterResult[]> {
	const timer = new Timer(logger);
	let result: LinterResult[] | undefined;
	const mergedOptions = args.mergeWithOptions(ARGS, options);

	try {
		timer.start();
		result = await Worker.run<LinterResult[]>(__filename, handleLintSass.name, mergedOptions);
		return result;
	} catch (error) {
		logger.error("", error);
		throw error;
	} finally {
		timer.finish();

		if (result && result.length && !mergedOptions.continueOnError) {
			process.exit(1);
		}
	}
}

/** @internal */
export async function handleLintSass(options: LintSassOptions): Promise<LinterResult[]> {
	const configFilePath = getConfigFilePath(options.config);
	logger.debug(handleLintSass.name, `Config file path: ${configFilePath}`);

	const configData = await fileSystem.readJsonFileAsync<JSON>(configFilePath);

	const failures = (
		await Promise.all(
			fileSystem.glob(options.files).map(x => lintFile(x, configData, options))
		)
	).filter(x => x.errored);

	failures.forEach(x => logger.info(formatters.string(x.results)));
	return failures;
}

async function lintFile(filePath: string, configData: JSON, options: LintSassOptions): Promise<LinterResult> {
	const fileContent = await fileSystem.readFileAsync(filePath);

	const lintOptions: LinterOptions = {
		config: configData,
		codeFilename: filePath,
		formatter: options.formatter,
		code: fileContent
	};

	const lintResult = await lint(lintOptions);

	if (!lintResult.errored || (lintResult.errored && !options.fix)) {
		return lintResult;
	}

	// let's try to fix lint issues
	const result = await postcss([
		stylefmt({ configFile: options.config })
	]).process(fileContent, {
		from: filePath,
		syntax: postcssScss
	});

	const fixedFilesContent = result.css;

	if (fixedFilesContent === fileContent) {
		logger.debug(lintFile.name, `Cannot fix lint issues, file: ${filePath}`);
		return lintResult;
	}

	logger.debug(lintFile.name, `Fixed some lint issues, file: ${filePath}`);
	writeFileSync(filePath, fixedFilesContent);

	lintOptions.code = fixedFilesContent;
	return await lint(lintOptions);
}