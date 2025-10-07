import {
	Client,
	Events,
	GatewayIntentBits,
	REST,
	Routes,
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	type CacheType,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ButtonInteraction,
	TextChannel,
} from "discord.js";
import { surebets, main, Surebet } from "./fetcher.js";
import { ensureEnv } from "./ensure_env.js";

await ensureEnv();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const GUILD_ID = process.env.GUILD_ID!;
const TOKEN = process.env.DISCORD_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!;

class Command {
	builder: SlashCommandBuilder;
	handle: (interaction: any) => void;

	constructor(builder: SlashCommandBuilder, handle: (interaction: any) => void) {
		this.builder = builder;
		this.handle = handle;
	}
}

const PAGE_SIZE = 5;
const userPages = new Map<string, number>();

const commands = [
	new Command(
		new SlashCommandBuilder().setName("surebets").setDescription("Replies with the list of surebets"),
		async (interaction: ChatInputCommandInteraction<CacheType>) => {
			await sendSurebetsPage(interaction, 0);
		}
	),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
	try {
		console.log("Registering guild commands...");
		await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands.map((c) => c.builder.toJSON()) });
		console.log("Guild commands registered successfully.");
	} catch (error) {
		console.error(error);
	}
})();

client.on(Events.InteractionCreate, async (interaction) => {
	if (interaction.isChatInputCommand()) {
		const command = commands.find((c) => c.builder.name === interaction.commandName);
		if (!command) return;

		try {
			await command.handle(interaction);
		} catch (err) {
			console.error("Error handling command:", err);
			await interaction.reply({ content: "There was an error executing this command.", ephemeral: true });
		}
	} else if (interaction.isButton()) {
		await handlePagination(interaction);
	}
});

function createSurebetPage(page: number) {
	const maxPage = Math.floor((surebets.size - 1) / PAGE_SIZE);

	const topSurebets = Array.from(surebets.values())
		.sort((a, b) => b.profitPercent - a.profitPercent)
		.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	const embed = new EmbedBuilder()
		.setTitle(`Surebets — Page ${page + 1}`)
		.setColor(0x00ae86)
		.setTimestamp();

	for (const surebet of topSurebets) {
		embed.addFields({
			name: surebet.eventName,
			value: `Profit: \`${surebet.profitPercent}%\`\nTime: <t:${Math.floor(surebet.time.getTime() / 1000)}:F>\nBookers: ${surebet.bookers.join(
				", "
			)}\nUrl: ${surebet.generateCalculatorUrl()}`,
		});
	}

	// Create navigation buttons
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("<<")
			.setLabel("<<")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId("<")
			.setLabel("<")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId(">")
			.setLabel(">")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page >= maxPage),
		new ButtonBuilder()
			.setCustomId(">>")
			.setLabel(">>")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page >= maxPage)
	);

	return { embed, row };
}

async function sendSurebetsPage(interaction: ChatInputCommandInteraction<CacheType>, page: number) {
	if (surebets.size === 0) {
		await interaction.reply("No surebets available at the moment.");
		return;
	}

	const { embed, row } = createSurebetPage(page);

	await interaction.reply({ embeds: [embed], components: [row] });
	const message = await interaction.fetchReply();
	userPages.set(message.id, page);
}

async function handlePagination(interaction: ButtonInteraction) {
	const messageId = interaction.message.id;
	const currentPage = userPages.get(messageId) ?? 0;
	const maxPage = Math.floor((surebets.size - 1) / PAGE_SIZE);
	let newPage = currentPage;

	switch (interaction.customId) {
		case "<<":
			newPage = 0;
			break;
		case "<":
			newPage = Math.max(0, currentPage - 1);
			break;
		case ">":
			newPage = Math.min(maxPage, currentPage + 1);
			break;
		case ">>":
			newPage = maxPage;
			break;
	}

	if (newPage === currentPage) {
		await interaction.deferUpdate();
		return;
	}

	const { embed, row } = createSurebetPage(newPage);

	userPages.set(messageId, newPage);
	await interaction.update({ embeds: [embed], components: [row] });
}

export async function alertSurebets(surebets: Surebet[]) {
	const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID!;
	const channel = await client.channels.fetch(ALERT_CHANNEL_ID);

	if (!channel || !channel.isTextBased()) {
		console.error("Alert channel not found or is not text-based.");
		return;
	}

	const textChannel = channel as TextChannel;

	if (surebets.length === 0) return;

	const chunkedSurebets = chunkArray(surebets, 4);

	for (const surebetChunk of chunkedSurebets) {
		const embed = new EmbedBuilder().setTitle("New Surebet Alerts!").setColor(0x00ff00).setTimestamp();

		let description = "";
		for (const surebet of surebetChunk) {
			const surebetInfo = `**${surebet.eventName} - (${surebet.bookers.join(", ")}) **
			Profit: \`${surebet.profitPercent}%\`
			ID: \`${surebet.id}\`
			URL: ${surebet.generateCalculatorUrl()}\n\n`;

			if (description.length + surebetInfo.length > 4096) {
				console.warn("Surebet info exceeds embed limit, skipping...");
				continue;
			}
			description += surebetInfo;
		}

		embed.setDescription(description);

		await textChannel.send({ embeds: [embed] });
	}
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
	const results: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		results.push(array.slice(i, i + chunkSize));
	}
	return results;
}

client.login(TOKEN);
main();
setInterval(() => {
	console.log("Fetching new surebets...");
	main();
}, 1000 * 60 * 5);
