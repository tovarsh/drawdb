import { tableColorStripHeight, tableFieldHeight, tableHeaderHeight, tableWidth as defaultTableWidth } from "../data/constants";
import { getIssues } from "../utils/issues";
import { exportSQL } from "../utils/exportSQL";

// ─── Shared helpers ───

const VALID_DB_TYPES = new Set([
  "mysql", "postgresql", "transactsql", "sqlite", "mariadb", "oraclesql", "generic",
]);

function errorResult(msg) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function mapFieldInput(f) {
  return {
    id: crypto.randomUUID(),
    name: f.name,
    type: f.type || "INT",
    default: f.default_value ?? f.default ?? "",
    check: f.check || "",
    primary: !!f.primary,
    unique: !!f.unique,
    unsigned: !!f.unsigned,
    notNull: f.nullable === false ? true : !!f.notNull,
    increment: f.increment !== undefined ? !!f.increment : !!f.primary,
    comment: f.comment || "",
    size: f.size || "",
    values: f.values || [],
  };
}

function findTableIndex(tables, name, index) {
  if (typeof index === "number" && index >= 0 && index < tables.length) return index;
  return tables.findIndex((t) => t.name === name);
}

function findTableAndField(tables, tableName, fieldName) {
  const table = tables.find((t) => t.name === tableName);
  if (!table) return { error: `Table "${tableName}" not found` };
  const field = table.fields.find((f) => f.name === fieldName);
  if (!field) return { error: `Field "${fieldName}" not found in "${tableName}"` };
  return { table, field };
}

// ─── Mutation dispatch ───

export function applyMutation(diagramRef, mutation) {
  if (!mutation) return;
  const { type, ...data } = mutation;
  switch (type) {
    case "add_table":
      diagramRef.current.setTables((prev) => [...prev, data.table]);
      break;
    case "add_relationship":
      diagramRef.current.setRelationships((prev) => [...prev, data.relationship]);
      break;
    case "set_tables":
      diagramRef.current.setTables(data.tables);
      break;
    case "set_relationships":
      diagramRef.current.setRelationships(data.relationships);
      break;
    case "delete_table":
      diagramRef.current.setTables(data.tables);
      diagramRef.current.setRelationships(data.relationships);
      break;
    case "clear_diagram":
      diagramRef.current.setTables([]);
      diagramRef.current.setRelationships([]);
      break;
  }
}

// ─── Tool handlers ───

export const toolHandlers = {
  ping() {
    return { content: [{ type: "text", text: "pong" }] };
  },

  list_tables(_args, { tables }) {
    if (!tables.length) {
      return { content: [{ type: "text", text: "No tables in the diagram." }] };
    }
    const lines = tables.map((t, i) => {
      const fields = t.fields.map((f) => `  ${f.name} ${f.type}${f.primary ? " PK" : ""}${f.notNull ? " NOT NULL" : ""}${f.unique ? " UNIQUE" : ""}${f.increment ? " AUTO_INCREMENT" : ""}`).join("\n");
      return `${t.name} [${i}] (${t.fields.length} fields):\n${fields}`;
    });
    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  },

  get_diagram(_args, { tables, relationships, database }, settings) {
    const tw = settings?.tableWidth ?? defaultTableWidth;
    const computeHeight = (t) => {
      const visibleFields = t.fields.filter((f) => !f.hidden);
      return tableHeaderHeight + tableColorStripHeight + visibleFields.length * tableFieldHeight;
    };
    const summary = {
      database,
      tableCount: tables.length,
      tables: tables.map((t, i) => ({
        name: t.name,
        index: i,
        fields: t.fields.map((f) => ({
          name: f.name,
          type: f.type,
          primary: f.primary,
          unique: f.unique,
          notNull: f.notNull,
          increment: f.increment,
          default: f.default,
          comment: f.comment,
        })),
        indices: t.indices?.length ?? 0,
        comment: t.comment || "",
        layout: { x: t.x, y: t.y, width: tw, height: computeHeight(t) },
      })),
      relationshipCount: relationships.length,
      relationships: relationships.map((r) => {
        const src = tables.find((t) => t.id === r.startTableId);
        const tgt = tables.find((t) => t.id === r.endTableId);
        const srcField = src?.fields.find((f) => f.id === r.startFieldId);
        const tgtField = tgt?.fields.find((f) => f.id === r.endFieldId);
        const card = r.cardinality === "one_to_one" ? "1:1" : r.cardinality === "n:m" ? "n:m" : r.cardinality === "one_to_many" ? "1:n" : r.cardinality === "many_to_one" ? "n:1" : r.cardinality || "?";
        let line = `${src?.name ?? "?"}.${srcField?.name ?? "?"} → ${tgt?.name ?? "?"}.${tgtField?.name ?? "?"} [${card}]`;
        if (r.updateConstraint) line += ` on_update:${r.updateConstraint}`;
        if (r.deleteConstraint) line += ` on_delete:${r.deleteConstraint}`;
        return line;
      }),
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },

  add_table(args, { tables }) {
    const { name, fields, color, comment } = args;
    if (!name) {
      return errorResult("table name is required");
    }
    if (!name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      return errorResult(`invalid table name "${name}". Use letters, digits, underscores. Must start with a letter or underscore.`);
    }
    let x = 50;
    let y = 50;
    if (tables.length > 0) {
      const maxY = Math.max(...tables.map((t) => t.y + t.fields.length * tableFieldHeight + tableHeaderHeight + tableColorStripHeight));
      x = 50;
      y = maxY + 60;
    }
    const table = {
      id: crypto.randomUUID(),
      name,
      x,
      y,
      locked: false,
      fields: (fields || [{ name: "id", type: "INT", primary: true }]).map(mapFieldInput),
      comment: comment || "",
      indices: [],
      color: color || "#175e7a",
      collapsed: false,
    };
    return {
      content: [{ type: "text", text: `Table "${name}" added with ${table.fields.length} fields at (${x}, ${y})` }],
      _mutate: { type: "add_table", table },
    };
  },

  delete_table(args, { tables, relationships }) {
    const { name, index } = args;
    const tableIndex = findTableIndex(tables, name, index);
    if (tableIndex === -1) {
      return errorResult(`table "${name}" not found`);
    }
    const table = tables[tableIndex];
    const tableId = table.id;
    const remainingRelationships = relationships.filter(
      (r) => r.startTableId !== tableId && r.endTableId !== tableId
    );
    const removedRels = relationships.length - remainingRelationships.length;
    const remainingTables = tables.filter((_, i) => i !== tableIndex);
    return {
      content: [{ type: "text", text: `Deleted table "${table.name}" and ${removedRels} relationship(s)` }],
      _mutate: {
        type: "delete_table",
        tables: remainingTables,
        relationships: remainingRelationships,
      },
    };
  },

  update_table(args, { tables }) {
    const { name, index, new_name, add_fields, drop_fields, alter_fields, comment, color } = args;
    const tableIndex = findTableIndex(tables, name, index);
    if (tableIndex === -1) {
      return errorResult(`table "${name}" not found`);
    }
    const old = tables[tableIndex];
    const updated = { ...old, fields: [...old.fields] };
    const changes = [];

    if (new_name && new_name !== old.name) {
      if (!new_name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return errorResult(`invalid table name "${new_name}"`);
      }
      updated.name = new_name;
      changes.push(`renamed to "${new_name}"`);
    }

    if (comment !== undefined) {
      updated.comment = comment;
      changes.push(`comment updated`);
    }

    if (color !== undefined) {
      updated.color = color;
      changes.push(`color set to ${color}`);
    }

    if (add_fields?.length) {
      const newFields = add_fields.map(mapFieldInput);
      updated.fields = [...updated.fields, ...newFields];
      changes.push(`added ${newFields.length} field(s): ${newFields.map((f) => f.name).join(", ")}`);
    }

    if (drop_fields?.length) {
      const before = updated.fields.length;
      const dropSet = new Set(drop_fields);
      updated.fields = updated.fields.filter((f) => !dropSet.has(f.name));
      const dropped = before - updated.fields.length;
      if (dropped > 0) changes.push(`dropped ${dropped} field(s)`);
      if (dropped < drop_fields.length) {
        changes.push(`(warning: ${drop_fields.length - dropped} field name(s) not found)`);
      }
    }

    if (alter_fields?.length) {
      for (const alt of alter_fields) {
        const field = updated.fields.find((f) => f.name === alt.name);
        if (!field) {
          changes.push(`(warning: field "${alt.name}" not found for alter)`);
          continue;
        }
        const parts = [];
        if (alt.new_name && alt.new_name !== field.name) { field.name = alt.new_name; parts.push("renamed"); }
        if (alt.type) { field.type = alt.type; parts.push(`type→${alt.type}`); }
        if (alt.primary !== undefined) { field.primary = alt.primary; parts.push(`primary→${alt.primary}`); }
        if (alt.nullable !== undefined) { field.notNull = !alt.nullable; parts.push(`notNull→${!alt.nullable}`); }
        if (alt.unique !== undefined) { field.unique = alt.unique; parts.push(`unique→${alt.unique}`); }
        if (alt.unsigned !== undefined) { field.unsigned = alt.unsigned; parts.push(`unsigned→${alt.unsigned}`); }
        if (alt.increment !== undefined) { field.increment = alt.increment; parts.push(`increment→${alt.increment}`); }
        if (alt.default_value !== undefined) { field.default = alt.default_value; parts.push("default updated"); }
        if (alt.check !== undefined) { field.check = alt.check; parts.push("check updated"); }
        if (alt.comment !== undefined) { field.comment = alt.comment; parts.push("comment updated"); }
        if (alt.size !== undefined) { field.size = alt.size; parts.push(`size→${alt.size}`); }
        changes.push(`altered "${alt.name}": ${parts.join(", ")}`);
      }
    }

    if (!changes.length) {
      return { content: [{ type: "text", text: "No changes specified" }] };
    }

    const newTables = [...tables];
    newTables[tableIndex] = updated;
    return {
      content: [{ type: "text", text: `Updated "${old.name}": ${changes.join("; ")}` }],
      _mutate: { type: "set_tables", tables: newTables },
    };
  },

  add_relationship(args, { tables, relationships }) {
    const { from_table, to_table, from_field, to_field, card, update_rule, delete_rule, name } = args;
    const srcResult = findTableAndField(tables, from_table, from_field);
    if (srcResult.error) return errorResult(srcResult.error);
    const tgtResult = findTableAndField(tables, to_table, to_field);
    if (tgtResult.error) return errorResult(tgtResult.error);
    const { table: src, field: srcField } = srcResult;
    const { table: tgt, field: tgtField } = tgtResult;

    // Check duplicate
    const duplicate = relationships.find(
      (r) => r.startTableId === src.id && r.startFieldId === srcField.id && r.endTableId === tgt.id && r.endFieldId === tgtField.id
    );
    if (duplicate) {
      return errorResult(`relationship ${from_table}.${from_field} → ${to_table}.${to_field} already exists`);
    }

    // Map cardinality
    let cardinality = "";
    if (card === "1:1") cardinality = "one_to_one";
    else if (card === "1:n" || card === "one_to_many") cardinality = "one_to_many";
    else if (card === "n:1" || card === "many_to_one") cardinality = "many_to_one";
    else if (card === "n:m") cardinality = "n:m";

    const rel = {
      id: crypto.randomUUID(),
      startTableId: src.id,
      startFieldId: srcField.id,
      endTableId: tgt.id,
      endFieldId: tgtField.id,
      cardinality,
      updateConstraint: update_rule || "No action",
      deleteConstraint: delete_rule || "No action",
      name: name || `${src.name}_${tgt.name}_fk`,
    };
    return {
      content: [{ type: "text", text: `Relationship: ${from_table}.${from_field} → ${to_table}.${to_field} [${card || "default"}]${update_rule ? ` on_update:${update_rule}` : ""}${delete_rule ? ` on_delete:${delete_rule}` : ""}` }],
      _mutate: { type: "add_relationship", relationship: rel },
    };
  },

  delete_relationship(args, { tables, relationships }) {
    const { from_table, from_field, to_table, to_field } = args;
    const srcResult = findTableAndField(tables, from_table, from_field);
    if (srcResult.error) return errorResult(srcResult.error);
    const tgtResult = findTableAndField(tables, to_table, to_field);
    if (tgtResult.error) return errorResult(tgtResult.error);
    const { table: src, field: srcField } = srcResult;
    const { table: tgt, field: tgtField } = tgtResult;

    const relIndex = relationships.findIndex(
      (r) => r.startTableId === src.id && r.startFieldId === srcField.id && r.endTableId === tgt.id && r.endFieldId === tgtField.id
    );
    if (relIndex === -1) {
      return errorResult(`relationship ${from_table}.${from_field} → ${to_table}.${to_field} not found`);
    }
    const remaining = relationships.filter((_, i) => i !== relIndex);
    return {
      content: [{ type: "text", text: `Deleted relationship: ${from_table}.${from_field} → ${to_table}.${to_field}` }],
      _mutate: { type: "set_relationships", relationships: remaining },
    };
  },

  set_layout(args, { tables }) {
    const { positions } = args;
    if (!positions || !positions.length) {
      return errorResult("positions array is empty");
    }
    const updatesByName = new Map();
    const unmatched = [];
    for (const p of positions) {
      const key = p.table_name;
      if (!updatesByName.has(key)) updatesByName.set(key, []);
      updatesByName.get(key).push({ x: p.x, y: p.y });
    }
    for (const name of updatesByName.keys()) {
      if (!tables.some((t) => t.name === name)) {
        unmatched.push(name);
      }
    }
    const consumed = new Map();
    const updated = tables.map((t) => {
      const entries = updatesByName.get(t.name);
      if (!entries) return t;
      const idx = consumed.get(t.name) ?? 0;
      consumed.set(t.name, idx + 1);
      if (idx < entries.length) {
        return { ...t, x: entries[idx].x, y: entries[idx].y };
      }
      return t;
    });
    const moved = positions.map((p) => `${p.table_name} → (${p.x}, ${p.y})`).join(", ");
    let msg = `Layout updated: ${moved}`;
    if (unmatched.length) {
      msg += `\nWarning: unknown tables ignored: ${unmatched.join(", ")}`;
    }
    return { content: [{ type: "text", text: msg }], _mutate: { type: "set_tables", tables: updated } };
  },

  get_issues(_args, ctx) {
    const diagram = {
      tables: ctx.tables,
      relationships: ctx.relationships,
      types: ctx.types,
      database: ctx.database,
      enums: ctx.enums,
    };
    const issues = getIssues(diagram);
    if (!issues.length) {
      return { content: [{ type: "text", text: "No issues found. Diagram is valid." }] };
    }
    return {
      content: [{ type: "text", text: `Found ${issues.length} issue(s):\n${issues.map((e, i) => `${i + 1}. ${e}`).join("\n")}` }],
    };
  },

  export_sql(_args, ctx) {
    const db = ctx.database;
    if (db === "generic") {
      return {
        content: [{ type: "text", text: "Error: Cannot export SQL for 'generic' database. Use set_database to switch to a specific database first (mysql, postgresql, sqlite, mariadb, transactsql, oraclesql)." }],
        isError: true,
      };
    }
    const sql = exportSQL({
      tables: ctx.tables,
      references: ctx.relationships,
      types: ctx.types,
      database: db,
      enums: ctx.enums,
    });
    if (!sql) {
      return { content: [{ type: "text", text: "Generated SQL is empty." }] };
    }
    return { content: [{ type: "text", text: sql }] };
  },

  set_database(args, ctx) {
    const { database } = args;
    if (!VALID_DB_TYPES.has(database)) {
      return errorResult(`unknown database "${database}". Valid options: ${[...VALID_DB_TYPES].join(", ")}`);
    }
    // Apply immediately — don't go through _mutate
    if (typeof ctx.setDatabase === "function") {
      ctx.setDatabase(database);
    }
    return {
      content: [{ type: "text", text: `Database set to "${database}"` }],
    };
  },

  clear_diagram() {
    return {
      content: [{ type: "text", text: "Diagram cleared. All tables, relationships removed." }],
      _mutate: { type: "clear_diagram" },
    };
  },

  undo(_args, ctx) {
    const stack = ctx.undoStack;
    if (!stack || !stack.length) {
      return { content: [{ type: "text", text: "Nothing to undo." }] };
    }
    const action = stack[stack.length - 1];
    const actionNames = { 0: "ADD", 1: "MOVE", 2: "DELETE", 3: "EDIT" };
    const elementNames = { 1: "table", 2: "area", 3: "note", 4: "relationship", 5: "type", 6: "enum" };
    const desc = `${actionNames[action.action] || "?"} ${elementNames[action.element] || "?"}${action.bulk ? " (bulk)" : ""}`;
    return {
      content: [{ type: "text", text: `Undo: ${desc}. Note: full undo requires UI interaction. Use delete_table/delete_relationship to undo specific changes.` }],
    };
  },
};
