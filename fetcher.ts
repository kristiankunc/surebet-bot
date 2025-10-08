import puppeteer, { Browser, ElementHandle, Page } from "puppeteer";

import fs from "fs/promises";
import { alertSurebets } from "./bot";
import path from "path";

const COOKIES_FILE = "data/cookies.json";

export const surebets: Map<string, Surebet> = new Map();

export class Surebet {
	id: string;
	profitPercent: number;
	time: Date;
	eventName: string;
	bookers: string[];

	constructor(id: string, profitPercent: number, time: Date, eventName: string, bookers: string[]) {
		this.id = id;
		this.profitPercent = profitPercent;
		this.time = time;
		this.eventName = eventName;
		this.bookers = bookers;
	}

	generateCalculatorUrl(): string {
		return `https://en.surebet.com/calculator/show/${this.id}?model=surebet`;
	}
}

async function dumpCookies(browser: Browser) {
	try {
		const cookies = await browser.cookies();
		const dir = path.dirname(COOKIES_FILE);

		await fs.mkdir(dir, { recursive: true });

		await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
	} catch (err) {
		console.warn("Could not write cookies file:", (err as Error).message);
	}
}

async function loadCookies(browser: Browser) {
	let cookiesString;
	try {
		cookiesString = await fs.readFile(COOKIES_FILE, "utf-8");
	} catch (e) {
		console.warn("No cookies file found, proceeding without loading cookies.");
		return;
	}

	const cookies = JSON.parse(cookiesString);

	await browser.setCookie(...cookies);
}

async function isLoggedIn(page: Page) {
	await page.goto("https://en.surebet.com/");
	return (await page.$("#current-user-section-dropdown-button")) !== null;
}

async function login(page: Page, username: string, password: string) {
	await page.goto("https://en.surebet.com/users/sign_in");
	await page.type("#user_email", username);
	await page.type("#user_password", password);

	page.click("#sign-in-form-submit-button");

	await page.waitForNavigation();
}

async function processSurebetRow(row: ElementHandle) {
	const id = await row.evaluate((el) => el.id.replace("surebet_record_", ""));
	const profitPercent = await row.$eval(".profit-box > span:first-child", (el) => el.dataset.profit);
	const time = await row.$eval("td.time > abbr", (el) => el.dataset.utc);
	const eventName = await row.$eval(".event > span.minor", (el) => el.innerText.trim());

	const bookerDivs = await row.$$(".booker");
	const bookers = [];
	for (const bookerDiv of bookerDivs) {
		bookers.push(await bookerDiv.$eval("a", (el) => el.innerText.trim()));
	}

	const btnGroup = await row.$(".btn-group");

	if (!profitPercent || !time || !eventName || bookers.length === 0) {
		console.warn("Missing data in surebet row, skipping.");
		console.table({ profitPercent, time, eventName, bookers });
		return null;
	}

	return new Surebet(id, Number(profitPercent), new Date(Number(time)), eventName, bookers);
}

async function loadSurebets(page: Page) {
	await page.goto("https://en.surebet.com/surebets");

	const table = await page.$("#surebets-table");

	const tbodys = await table?.$$("tbody:not(:first-child)");

	const surebets = [];
	for (const tbody of tbodys || []) {
		const surebet = await processSurebetRow(tbody);
		if (surebet) surebets.push(surebet);
	}

	return surebets;
}

export async function main() {
	//const browser = await puppeteer.launch({ headless: false });
	const browser = await puppeteer.launch({
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
	});
	const page = await browser.newPage();

	loadCookies(browser);
	if (!(await isLoggedIn(page))) {
		await login(page, process.env.EMAIL!, process.env.PASSWORD!);
		await dumpCookies(browser);
	}

	const fetchedSurebets = await loadSurebets(page);
	const surbetsToAlert = [];
	surebets.clear();

	for (const surebet of fetchedSurebets) {
		surebets.set(surebet.id, surebet);
		if (surebet.profitPercent >= Number(process.env.ALERT_THRESHOLD)!) {
			surbetsToAlert.push(surebet);
		}
	}

	await alertSurebets(surbetsToAlert);

	console.log(`Fetched ${surebets.size} surebets:`);

	await browser.close();
}

if (require.main === module) {
	main();
}
