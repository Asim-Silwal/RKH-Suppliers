import { createInsertSchema } from "drizzle-zod";
import { integer, index, numeric, pgEnum, pgTable, serial, text, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { z } from "zod";

export const transactionTypeEnum = pgEnum("transaction_type", ["PURCHASE", "PAYMENT"]);

export const partiesTable = pgTable(
	"parties",
	{
		id: serial("id").primaryKey(),
		name: varchar("name", { length: 160 }).notNull(),
		companyName: varchar("company_name", { length: 200 }),
		contact: varchar("contact", { length: 40 }),
		location: varchar("location", { length: 160 }),
		notes: text("notes"),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("parties_name_idx").on(table.name), index("parties_archived_at_idx").on(table.archivedAt)],
);

export const transactionsTable = pgTable(
	"transactions",
	{
		id: serial("id").primaryKey(),
		partyId: integer("party_id").notNull().references(() => partiesTable.id, { onDelete: "restrict" }),
		type: transactionTypeEnum("type").notNull(),
		amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
		dateAd: date("date_ad").notNull(),
		dateBs: varchar("date_bs", { length: 10 }).notNull(),
		description: text("description"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("transactions_party_id_idx").on(table.partyId),
		index("transactions_date_ad_idx").on(table.dateAd),
		index("transactions_type_idx").on(table.type),
	],
);

export const insertPartySchema = createInsertSchema(partiesTable).omit({
	id: true,
	archivedAt: true,
	createdAt: true,
	updatedAt: true,
});
export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

export const transactionTypeSchema = z.enum(["PURCHASE", "PAYMENT"]);
export type Party = typeof partiesTable.$inferSelect;
export type NewParty = typeof partiesTable.$inferInsert;
export type Transaction = typeof transactionsTable.$inferSelect;
export type NewTransaction = typeof transactionsTable.$inferInsert;