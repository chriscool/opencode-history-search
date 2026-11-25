// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/storage-sqlite.ts
var exports_storage_sqlite = {};
__export(exports_storage_sqlite, {
  toolOutput: () => toolOutput,
  openDb: () => openDb,
  listSessionsSqlite: () => listSessionsSqlite,
  listPartsSqlite: () => listPartsSqlite,
  listMessagesSqlite: () => listMessagesSqlite,
  getDbPath: () => getDbPath,
  SEARCHABLE_MESSAGE_TYPES: () => SEARCHABLE_MESSAGE_TYPES
});
import { Database } from "bun:sqlite";
import path from "path";
import os from "os";
function getDbPath() {
  const dataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode");
  const file = process.env.OPENCODE_DB || "opencode.db";
  return file === ":memory:" ? file : path.resolve(dataDir, file);
}
function openDb() {
  const dbPath = getDbPath();
  if (dbPath === ":memory:") {
    throw new Error("OpenCode keeps its database in memory (OPENCODE_DB=:memory:), so there is no history to search.");
  }
  if (!dbExists(dbPath)) {
    throw new Error(`OpenCode database not found at ${dbPath}. If OpenCode keeps it elsewhere, set OPENCODE_DB to its path.`);
  }
  return new Database(dbPath, { readonly: true });
}
function dbExists(dbPath) {
  try {
    return Bun.file(dbPath).size > 0;
  } catch {
    return false;
  }
}
async function* listSessionsSqlite(projectID, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const projectFilter = projectID !== null ? "WHERE project_id = ?" : "";
    const rows = _db.query(`SELECT id, project_id, title, directory, time_created, time_updated
         FROM session_v2 ${projectFilter}
         ORDER BY time_updated DESC`).all(...projectID !== null ? [projectID] : []);
    for (const row of rows) {
      yield {
        id: row.id,
        projectID: row.project_id,
        title: row.title ?? "",
        directory: row.directory,
        time: { created: row.time_created, updated: row.time_updated }
      };
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}
async function* listMessagesSqlite(sessionID, role, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const types = role ? [role] : [...SEARCHABLE_MESSAGE_TYPES];
    const rows = _db.query(`SELECT id, session_id, type, time_created, data
         FROM session_message
         WHERE session_id = ? AND type IN (${types.map(() => "?").join(",")})
         ORDER BY seq ASC`).all(sessionID, ...types);
    for (const row of rows) {
      yield {
        id: row.id,
        sessionID: row.session_id,
        role: row.type,
        agent: row.type === "assistant" ? parseJson(row.data)?.agent ?? "" : "user",
        time: { created: row.time_created }
      };
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}
async function* listPartsSqlite(messageID, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const message = _db.query(`SELECT session_id, type, data FROM session_message WHERE id = ?`).get(messageID);
    if (!message)
      return;
    const data = parseJson(message.data);
    if (!data)
      return;
    const base = { messageID, sessionID: message.session_id };
    if (message.type === "user") {
      if (typeof data.text === "string" && data.text) {
        yield { ...base, id: messageID, type: "text", text: data.text };
      }
      return;
    }
    if (message.type !== "assistant")
      return;
    const rows = _db.query(`SELECT ordinal, data FROM session_part
         WHERE message_id = ? ORDER BY ordinal ASC`).all(messageID);
    const stored = rows.flatMap((row) => {
      const content = parseJson(row.data);
      return content ? [{ id: `${messageID}:${row.ordinal}`, content }] : [];
    });
    const inline = Array.isArray(data.content) ? data.content.map((content, index) => ({
      id: `${messageID}:inline:${index}`,
      content
    })) : [];
    for (const entry of [...stored, ...inline]) {
      const part = toPart(entry.content);
      if (part)
        yield { ...base, ...part, id: entry.id };
    }
    const files = data.snapshot?.files;
    if (Array.isArray(files) && files.length > 0) {
      yield { ...base, id: `${messageID}:snapshot`, type: "patch", files };
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}
function toPart(content) {
  if (content?.type === "text" && typeof content.text === "string") {
    return { type: "text", text: content.text };
  }
  if (content?.type === "tool" && typeof content.name === "string") {
    return {
      type: "tool",
      tool: content.name,
      state: {
        input: content.state?.input,
        output: toolOutput(content.state?.content),
        title: content.name
      }
    };
  }
  return;
}
function toolOutput(content) {
  if (!Array.isArray(content))
    return "";
  return content.flatMap((item) => item?.type === "text" && typeof item.text === "string" ? [item.text] : []).join(`
`);
}
function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return;
  }
}
var SEARCHABLE_MESSAGE_TYPES;
var init_storage_sqlite = __esm(() => {
  SEARCHABLE_MESSAGE_TYPES = ["user", "assistant"];
});

// src/storage-provider.ts
init_storage_sqlite();
async function* listSessions(projectID) {
  yield* listSessionsSqlite(projectID);
}
async function* listMessages(sessionID, role) {
  yield* listMessagesSqlite(sessionID, role);
}
async function* listParts(messageID) {
  yield* listPartsSqlite(messageID);
}

// src/search/date-filter.ts
function parseDateFilter(filter) {
  const normalized = filter.trim().toLowerCase();
  if (normalized === "today") {
    const start = new Date;
    start.setHours(0, 0, 0, 0);
    const end = new Date;
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (normalized === "yesterday") {
    const start = new Date;
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const relativeMatch = normalized.match(/^last (\d+) (day|week|month)s?$/);
  if (relativeMatch && relativeMatch[1] && relativeMatch[2]) {
    const count = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const end = new Date;
    const start = new Date;
    if (unit === "day") {
      start.setDate(start.getDate() - count);
    } else if (unit === "week") {
      start.setDate(start.getDate() - count * 7);
    } else if (unit === "month") {
      start.setMonth(start.getMonth() - count);
    }
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const rangeMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = new Date(rangeMatch[1]);
    const end = new Date(rangeMatch[2]);
    end.setHours(23, 59, 59, 999);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`Invalid date range: ${filter}`);
    }
    if (start > end) {
      throw new Error(`Start date must be before end date: ${filter}`);
    }
    return { start, end };
  }
  const isoMatch = normalized.match(/^(\d{4}-\d{2}(?:-\d{2})?)$/);
  if (isoMatch && isoMatch[1]) {
    const dateStr = isoMatch[1];
    if (dateStr.match(/^\d{4}-\d{2}$/)) {
      const start2 = new Date(`${dateStr}-01`);
      const end2 = new Date(start2);
      end2.setMonth(end2.getMonth() + 1);
      end2.setDate(0);
      end2.setHours(23, 59, 59, 999);
      if (isNaN(start2.getTime())) {
        throw new Error(`Invalid date: ${filter}`);
      }
      return { start: start2, end: end2 };
    }
    const start = new Date(dateStr);
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);
    if (isNaN(start.getTime())) {
      throw new Error(`Invalid date: ${filter}`);
    }
    return { start, end };
  }
  throw new Error(`Unrecognized date filter format: ${filter}. Supported formats: "today", "yesterday", "last N days/weeks/months", "YYYY-MM-DD", "YYYY-MM", "YYYY-MM-DD to YYYY-MM-DD"`);
}
function inDateRange(timestamp, dateRange) {
  if (!dateRange)
    return true;
  return timestamp >= dateRange.start.getTime() && timestamp <= dateRange.end.getTime();
}

// src/search/keyword.ts
async function searchKeyword(projectID, query, options = {}) {
  const results = [];
  const pattern = options.regex ? new RegExp(query, options.caseSensitive ? "" : "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "" : "i");
  const limit = options.limit || 50;
  for await (const session of listSessions(projectID)) {
    if (results.length >= limit)
      break;
    if (inDateRange(session.time.updated, options.dateRange) && pattern.test(session.title)) {
      results.push({
        sessionID: session.id,
        sessionTitle: session.title,
        timestamp: session.time.updated,
        matchType: "title",
        excerpt: session.title,
        context: session.title,
        projectDirectory: session.directory
      });
      if (results.length >= limit)
        break;
    }
    for await (const message of listMessages(session.id, options.role)) {
      if (results.length >= limit)
        break;
      if (!inDateRange(message.time.created, options.dateRange))
        continue;
      for await (const part of listParts(message.id)) {
        if (results.length >= limit)
          break;
        if (part.type === "text" && part.text && pattern.test(part.text)) {
          const match = part.text.match(pattern);
          const matchIndex = match ? part.text.indexOf(match[0]) : 0;
          const contextStart = Math.max(0, matchIndex - 100);
          const contextEnd = Math.min(part.text.length, matchIndex + match[0].length + 100);
          const context = part.text.slice(contextStart, contextEnd);
          results.push({
            sessionID: session.id,
            sessionTitle: session.title,
            timestamp: message.time.created,
            matchType: "message",
            excerpt: match ? match[0] : query,
            context,
            messageID: message.id,
            partID: part.id,
            projectDirectory: session.directory
          });
          if (results.length >= limit)
            break;
        }
        if (results.length >= limit)
          break;
        if (part.type === "tool" && part.tool && pattern.test(part.tool)) {
          results.push({
            sessionID: session.id,
            sessionTitle: session.title,
            timestamp: message.time.created,
            matchType: "tool",
            excerpt: part.tool,
            context: part.state?.title || part.tool,
            messageID: message.id,
            partID: part.id,
            projectDirectory: session.directory
          });
          if (results.length >= limit)
            break;
        }
        if (results.length >= limit)
          break;
        if (part.type === "tool" && part.state) {
          const inputStr = JSON.stringify(part.state.input || {});
          const outputStr = part.state.output || "";
          if (pattern.test(inputStr) || pattern.test(outputStr)) {
            const matched = pattern.exec(inputStr) || pattern.exec(outputStr);
            if (matched) {
              results.push({
                sessionID: session.id,
                sessionTitle: session.title,
                timestamp: message.time.created,
                matchType: "filepath",
                excerpt: matched[0],
                context: part.state.title || part.tool || "",
                messageID: message.id,
                partID: part.id,
                projectDirectory: session.directory
              });
              if (results.length >= limit)
                break;
            }
          }
        }
        if (results.length < limit && part.type === "patch" && part.files) {
          for (const filePath of part.files) {
            if (results.length >= limit)
              break;
            if (pattern.test(filePath)) {
              results.push({
                sessionID: session.id,
                sessionTitle: session.title,
                timestamp: message.time.created,
                matchType: "filepath",
                excerpt: filePath,
                context: `Modified file: ${filePath}`,
                messageID: message.id,
                partID: part.id,
                projectDirectory: session.directory
              });
            }
          }
        }
      }
    }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

// node_modules/fuse.js/dist/fuse.mjs
function isArray(value) {
  return !Array.isArray ? getTag(value) === "[object Array]" : Array.isArray(value);
}
var INFINITY = 1 / 0;
function baseToString(value) {
  if (typeof value == "string") {
    return value;
  }
  let result = value + "";
  return result == "0" && 1 / value == -INFINITY ? "-0" : result;
}
function toString(value) {
  return value == null ? "" : baseToString(value);
}
function isString(value) {
  return typeof value === "string";
}
function isNumber(value) {
  return typeof value === "number";
}
function isBoolean(value) {
  return value === true || value === false || isObjectLike(value) && getTag(value) == "[object Boolean]";
}
function isObject(value) {
  return typeof value === "object";
}
function isObjectLike(value) {
  return isObject(value) && value !== null;
}
function isDefined(value) {
  return value !== undefined && value !== null;
}
function isBlank(value) {
  return !value.trim().length;
}
function getTag(value) {
  return value == null ? value === undefined ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(value);
}
var INCORRECT_INDEX_TYPE = "Incorrect 'index' type";
var LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key) => `Invalid value for key ${key}`;
var PATTERN_LENGTH_TOO_LARGE = (max) => `Pattern length exceeds max of ${max}.`;
var MISSING_KEY_PROPERTY = (name) => `Missing ${name} property in key`;
var INVALID_KEY_WEIGHT_VALUE = (key) => `Property 'weight' in key '${key}' must be a positive integer`;
var hasOwn = Object.prototype.hasOwnProperty;

class KeyStore {
  constructor(keys) {
    this._keys = [];
    this._keyMap = {};
    let totalWeight = 0;
    keys.forEach((key) => {
      let obj = createKey(key);
      this._keys.push(obj);
      this._keyMap[obj.id] = obj;
      totalWeight += obj.weight;
    });
    this._keys.forEach((key) => {
      key.weight /= totalWeight;
    });
  }
  get(keyId) {
    return this._keyMap[keyId];
  }
  keys() {
    return this._keys;
  }
  toJSON() {
    return JSON.stringify(this._keys);
  }
}
function createKey(key) {
  let path2 = null;
  let id = null;
  let src = null;
  let weight = 1;
  let getFn = null;
  if (isString(key) || isArray(key)) {
    src = key;
    path2 = createKeyPath(key);
    id = createKeyId(key);
  } else {
    if (!hasOwn.call(key, "name")) {
      throw new Error(MISSING_KEY_PROPERTY("name"));
    }
    const name = key.name;
    src = name;
    if (hasOwn.call(key, "weight")) {
      weight = key.weight;
      if (weight <= 0) {
        throw new Error(INVALID_KEY_WEIGHT_VALUE(name));
      }
    }
    path2 = createKeyPath(name);
    id = createKeyId(name);
    getFn = key.getFn;
  }
  return { path: path2, id, weight, src, getFn };
}
function createKeyPath(key) {
  return isArray(key) ? key : key.split(".");
}
function createKeyId(key) {
  return isArray(key) ? key.join(".") : key;
}
function get(obj, path2) {
  let list = [];
  let arr = false;
  const deepGet = (obj2, path3, index) => {
    if (!isDefined(obj2)) {
      return;
    }
    if (!path3[index]) {
      list.push(obj2);
    } else {
      let key = path3[index];
      const value = obj2[key];
      if (!isDefined(value)) {
        return;
      }
      if (index === path3.length - 1 && (isString(value) || isNumber(value) || isBoolean(value))) {
        list.push(toString(value));
      } else if (isArray(value)) {
        arr = true;
        for (let i = 0, len = value.length;i < len; i += 1) {
          deepGet(value[i], path3, index + 1);
        }
      } else if (path3.length) {
        deepGet(value, path3, index + 1);
      }
    }
  };
  deepGet(obj, isString(path2) ? path2.split(".") : path2, 0);
  return arr ? list : list[0];
}
var MatchOptions = {
  includeMatches: false,
  findAllMatches: false,
  minMatchCharLength: 1
};
var BasicOptions = {
  isCaseSensitive: false,
  ignoreDiacritics: false,
  includeScore: false,
  keys: [],
  shouldSort: true,
  sortFn: (a, b) => a.score === b.score ? a.idx < b.idx ? -1 : 1 : a.score < b.score ? -1 : 1
};
var FuzzyOptions = {
  location: 0,
  threshold: 0.6,
  distance: 100
};
var AdvancedOptions = {
  useExtendedSearch: false,
  getFn: get,
  ignoreLocation: false,
  ignoreFieldNorm: false,
  fieldNormWeight: 1
};
var Config = {
  ...BasicOptions,
  ...MatchOptions,
  ...FuzzyOptions,
  ...AdvancedOptions
};
var SPACE = /[^ ]+/g;
function norm(weight = 1, mantissa = 3) {
  const cache = new Map;
  const m = Math.pow(10, mantissa);
  return {
    get(value) {
      const numTokens = value.match(SPACE).length;
      if (cache.has(numTokens)) {
        return cache.get(numTokens);
      }
      const norm2 = 1 / Math.pow(numTokens, 0.5 * weight);
      const n = parseFloat(Math.round(norm2 * m) / m);
      cache.set(numTokens, n);
      return n;
    },
    clear() {
      cache.clear();
    }
  };
}

class FuseIndex {
  constructor({
    getFn = Config.getFn,
    fieldNormWeight = Config.fieldNormWeight
  } = {}) {
    this.norm = norm(fieldNormWeight, 3);
    this.getFn = getFn;
    this.isCreated = false;
    this.setIndexRecords();
  }
  setSources(docs = []) {
    this.docs = docs;
  }
  setIndexRecords(records = []) {
    this.records = records;
  }
  setKeys(keys = []) {
    this.keys = keys;
    this._keysMap = {};
    keys.forEach((key, idx) => {
      this._keysMap[key.id] = idx;
    });
  }
  create() {
    if (this.isCreated || !this.docs.length) {
      return;
    }
    this.isCreated = true;
    if (isString(this.docs[0])) {
      this.docs.forEach((doc, docIndex) => {
        this._addString(doc, docIndex);
      });
    } else {
      this.docs.forEach((doc, docIndex) => {
        this._addObject(doc, docIndex);
      });
    }
    this.norm.clear();
  }
  add(doc) {
    const idx = this.size();
    if (isString(doc)) {
      this._addString(doc, idx);
    } else {
      this._addObject(doc, idx);
    }
  }
  removeAt(idx) {
    this.records.splice(idx, 1);
    for (let i = idx, len = this.size();i < len; i += 1) {
      this.records[i].i -= 1;
    }
  }
  getValueForItemAtKeyId(item, keyId) {
    return item[this._keysMap[keyId]];
  }
  size() {
    return this.records.length;
  }
  _addString(doc, docIndex) {
    if (!isDefined(doc) || isBlank(doc)) {
      return;
    }
    let record = {
      v: doc,
      i: docIndex,
      n: this.norm.get(doc)
    };
    this.records.push(record);
  }
  _addObject(doc, docIndex) {
    let record = { i: docIndex, $: {} };
    this.keys.forEach((key, keyIndex) => {
      let value = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);
      if (!isDefined(value)) {
        return;
      }
      if (isArray(value)) {
        let subRecords = [];
        const stack = [{ nestedArrIndex: -1, value }];
        while (stack.length) {
          const { nestedArrIndex, value: value2 } = stack.pop();
          if (!isDefined(value2)) {
            continue;
          }
          if (isString(value2) && !isBlank(value2)) {
            let subRecord = {
              v: value2,
              i: nestedArrIndex,
              n: this.norm.get(value2)
            };
            subRecords.push(subRecord);
          } else if (isArray(value2)) {
            value2.forEach((item, k) => {
              stack.push({
                nestedArrIndex: k,
                value: item
              });
            });
          } else
            ;
        }
        record.$[keyIndex] = subRecords;
      } else if (isString(value) && !isBlank(value)) {
        let subRecord = {
          v: value,
          n: this.norm.get(value)
        };
        record.$[keyIndex] = subRecord;
      }
    });
    this.records.push(record);
  }
  toJSON() {
    return {
      keys: this.keys,
      records: this.records
    };
  }
}
function createIndex(keys, docs, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys.map(createKey));
  myIndex.setSources(docs);
  myIndex.create();
  return myIndex;
}
function parseIndex(data, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const { keys, records } = data;
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys);
  myIndex.setIndexRecords(records);
  return myIndex;
}
function computeScore$1(pattern, {
  errors = 0,
  currentLocation = 0,
  expectedLocation = 0,
  distance = Config.distance,
  ignoreLocation = Config.ignoreLocation
} = {}) {
  const accuracy = errors / pattern.length;
  if (ignoreLocation) {
    return accuracy;
  }
  const proximity = Math.abs(expectedLocation - currentLocation);
  if (!distance) {
    return proximity ? 1 : accuracy;
  }
  return accuracy + proximity / distance;
}
function convertMaskToIndices(matchmask = [], minMatchCharLength = Config.minMatchCharLength) {
  let indices = [];
  let start = -1;
  let end = -1;
  let i = 0;
  for (let len = matchmask.length;i < len; i += 1) {
    let match = matchmask[i];
    if (match && start === -1) {
      start = i;
    } else if (!match && start !== -1) {
      end = i - 1;
      if (end - start + 1 >= minMatchCharLength) {
        indices.push([start, end]);
      }
      start = -1;
    }
  }
  if (matchmask[i - 1] && i - start >= minMatchCharLength) {
    indices.push([start, i - 1]);
  }
  return indices;
}
var MAX_BITS = 32;
function search(text, pattern, patternAlphabet, {
  location = Config.location,
  distance = Config.distance,
  threshold = Config.threshold,
  findAllMatches = Config.findAllMatches,
  minMatchCharLength = Config.minMatchCharLength,
  includeMatches = Config.includeMatches,
  ignoreLocation = Config.ignoreLocation
} = {}) {
  if (pattern.length > MAX_BITS) {
    throw new Error(PATTERN_LENGTH_TOO_LARGE(MAX_BITS));
  }
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  let currentThreshold = threshold;
  let bestLocation = expectedLocation;
  const computeMatches = minMatchCharLength > 1 || includeMatches;
  const matchMask = computeMatches ? Array(textLen) : [];
  let index;
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    let score = computeScore$1(pattern, {
      currentLocation: index,
      expectedLocation,
      distance,
      ignoreLocation
    });
    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;
    if (computeMatches) {
      let i = 0;
      while (i < patternLen) {
        matchMask[index + i] = 1;
        i += 1;
      }
    }
  }
  bestLocation = -1;
  let lastBitArr = [];
  let finalScore = 1;
  let binMax = patternLen + textLen;
  const mask = 1 << patternLen - 1;
  for (let i = 0;i < patternLen; i += 1) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      const score2 = computeScore$1(pattern, {
        errors: i,
        currentLocation: expectedLocation + binMid,
        expectedLocation,
        distance,
        ignoreLocation
      });
      if (score2 <= currentThreshold) {
        binMin = binMid;
      } else {
        binMax = binMid;
      }
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;
    let start = Math.max(1, expectedLocation - binMid + 1);
    let finish = findAllMatches ? textLen : Math.min(expectedLocation + binMid, textLen) + patternLen;
    let bitArr = Array(finish + 2);
    bitArr[finish + 1] = (1 << i) - 1;
    for (let j = finish;j >= start; j -= 1) {
      let currentLocation = j - 1;
      let charMatch = patternAlphabet[text.charAt(currentLocation)];
      if (computeMatches) {
        matchMask[currentLocation] = +!!charMatch;
      }
      bitArr[j] = (bitArr[j + 1] << 1 | 1) & charMatch;
      if (i) {
        bitArr[j] |= (lastBitArr[j + 1] | lastBitArr[j]) << 1 | 1 | lastBitArr[j + 1];
      }
      if (bitArr[j] & mask) {
        finalScore = computeScore$1(pattern, {
          errors: i,
          currentLocation,
          expectedLocation,
          distance,
          ignoreLocation
        });
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          if (bestLocation <= expectedLocation) {
            break;
          }
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }
    const score = computeScore$1(pattern, {
      errors: i + 1,
      currentLocation: expectedLocation,
      expectedLocation,
      distance,
      ignoreLocation
    });
    if (score > currentThreshold) {
      break;
    }
    lastBitArr = bitArr;
  }
  const result = {
    isMatch: bestLocation >= 0,
    score: Math.max(0.001, finalScore)
  };
  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (!indices.length) {
      result.isMatch = false;
    } else if (includeMatches) {
      result.indices = indices;
    }
  }
  return result;
}
function createPatternAlphabet(pattern) {
  let mask = {};
  for (let i = 0, len = pattern.length;i < len; i += 1) {
    const char = pattern.charAt(i);
    mask[char] = (mask[char] || 0) | 1 << len - i - 1;
  }
  return mask;
}
var stripDiacritics = String.prototype.normalize ? (str) => str.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (str) => str;

class BitapSearch {
  constructor(pattern, {
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance,
    includeMatches = Config.includeMatches,
    findAllMatches = Config.findAllMatches,
    minMatchCharLength = Config.minMatchCharLength,
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    ignoreLocation = Config.ignoreLocation
  } = {}) {
    this.options = {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.chunks = [];
    if (!this.pattern.length) {
      return;
    }
    const addChunk = (pattern2, startIndex) => {
      this.chunks.push({
        pattern: pattern2,
        alphabet: createPatternAlphabet(pattern2),
        startIndex
      });
    };
    const len = this.pattern.length;
    if (len > MAX_BITS) {
      let i = 0;
      const remainder = len % MAX_BITS;
      const end = len - remainder;
      while (i < end) {
        addChunk(this.pattern.substr(i, MAX_BITS), i);
        i += MAX_BITS;
      }
      if (remainder) {
        const startIndex = len - MAX_BITS;
        addChunk(this.pattern.substr(startIndex), startIndex);
      }
    } else {
      addChunk(this.pattern, 0);
    }
  }
  searchIn(text) {
    const { isCaseSensitive, ignoreDiacritics, includeMatches } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    if (this.pattern === text) {
      let result2 = {
        isMatch: true,
        score: 0
      };
      if (includeMatches) {
        result2.indices = [[0, text.length - 1]];
      }
      return result2;
    }
    const {
      location,
      distance,
      threshold,
      findAllMatches,
      minMatchCharLength,
      ignoreLocation
    } = this.options;
    let allIndices = [];
    let totalScore = 0;
    let hasMatches = false;
    this.chunks.forEach(({ pattern, alphabet, startIndex }) => {
      const { isMatch, score, indices } = search(text, pattern, alphabet, {
        location: location + startIndex,
        distance,
        threshold,
        findAllMatches,
        minMatchCharLength,
        includeMatches,
        ignoreLocation
      });
      if (isMatch) {
        hasMatches = true;
      }
      totalScore += score;
      if (isMatch && indices) {
        allIndices = [...allIndices, ...indices];
      }
    });
    let result = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1
    };
    if (hasMatches && includeMatches) {
      result.indices = allIndices;
    }
    return result;
  }
}

class BaseMatch {
  constructor(pattern) {
    this.pattern = pattern;
  }
  static isMultiMatch(pattern) {
    return getMatch(pattern, this.multiRegex);
  }
  static isSingleMatch(pattern) {
    return getMatch(pattern, this.singleRegex);
  }
  search() {}
}
function getMatch(pattern, exp) {
  const matches = pattern.match(exp);
  return matches ? matches[1] : null;
}

class ExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "exact";
  }
  static get multiRegex() {
    return /^="(.*)"$/;
  }
  static get singleRegex() {
    return /^=(.*)$/;
  }
  search(text) {
    const isMatch = text === this.pattern;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}

class InverseExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"$/;
  }
  static get singleRegex() {
    return /^!(.*)$/;
  }
  search(text) {
    const index = text.indexOf(this.pattern);
    const isMatch = index === -1;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class PrefixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "prefix-exact";
  }
  static get multiRegex() {
    return /^\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^\^(.*)$/;
  }
  search(text) {
    const isMatch = text.startsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}

class InversePrefixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-prefix-exact";
  }
  static get multiRegex() {
    return /^!\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^!\^(.*)$/;
  }
  search(text) {
    const isMatch = !text.startsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class SuffixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "suffix-exact";
  }
  static get multiRegex() {
    return /^"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^(.*)\$$/;
  }
  search(text) {
    const isMatch = text.endsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [text.length - this.pattern.length, text.length - 1]
    };
  }
}

class InverseSuffixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-suffix-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^!(.*)\$$/;
  }
  search(text) {
    const isMatch = !text.endsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class FuzzyMatch extends BaseMatch {
  constructor(pattern, {
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance,
    includeMatches = Config.includeMatches,
    findAllMatches = Config.findAllMatches,
    minMatchCharLength = Config.minMatchCharLength,
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    ignoreLocation = Config.ignoreLocation
  } = {}) {
    super(pattern);
    this._bitapSearch = new BitapSearch(pattern, {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    });
  }
  static get type() {
    return "fuzzy";
  }
  static get multiRegex() {
    return /^"(.*)"$/;
  }
  static get singleRegex() {
    return /^(.*)$/;
  }
  search(text) {
    return this._bitapSearch.searchIn(text);
  }
}

class IncludeMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "include";
  }
  static get multiRegex() {
    return /^'"(.*)"$/;
  }
  static get singleRegex() {
    return /^'(.*)$/;
  }
  search(text) {
    let location = 0;
    let index;
    const indices = [];
    const patternLen = this.pattern.length;
    while ((index = text.indexOf(this.pattern, location)) > -1) {
      location = index + patternLen;
      indices.push([index, location - 1]);
    }
    const isMatch = !!indices.length;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices
    };
  }
}
var searchers = [
  ExactMatch,
  IncludeMatch,
  PrefixExactMatch,
  InversePrefixExactMatch,
  InverseSuffixExactMatch,
  SuffixExactMatch,
  InverseExactMatch,
  FuzzyMatch
];
var searchersLen = searchers.length;
var SPACE_RE = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/;
var OR_TOKEN = "|";
function parseQuery(pattern, options = {}) {
  return pattern.split(OR_TOKEN).map((item) => {
    let query = item.trim().split(SPACE_RE).filter((item2) => item2 && !!item2.trim());
    let results = [];
    for (let i = 0, len = query.length;i < len; i += 1) {
      const queryItem = query[i];
      let found = false;
      let idx = -1;
      while (!found && ++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isMultiMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          found = true;
        }
      }
      if (found) {
        continue;
      }
      idx = -1;
      while (++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isSingleMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          break;
        }
      }
    }
    return results;
  });
}
var MultiMatchSet = new Set([FuzzyMatch.type, IncludeMatch.type]);

class ExtendedSearch {
  constructor(pattern, {
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    includeMatches = Config.includeMatches,
    minMatchCharLength = Config.minMatchCharLength,
    ignoreLocation = Config.ignoreLocation,
    findAllMatches = Config.findAllMatches,
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance
  } = {}) {
    this.query = null;
    this.options = {
      isCaseSensitive,
      ignoreDiacritics,
      includeMatches,
      minMatchCharLength,
      findAllMatches,
      ignoreLocation,
      location,
      threshold,
      distance
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.query = parseQuery(this.pattern, this.options);
  }
  static condition(_, options) {
    return options.useExtendedSearch;
  }
  searchIn(text) {
    const query = this.query;
    if (!query) {
      return {
        isMatch: false,
        score: 1
      };
    }
    const { includeMatches, isCaseSensitive, ignoreDiacritics } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    let numMatches = 0;
    let allIndices = [];
    let totalScore = 0;
    for (let i = 0, qLen = query.length;i < qLen; i += 1) {
      const searchers2 = query[i];
      allIndices.length = 0;
      numMatches = 0;
      for (let j = 0, pLen = searchers2.length;j < pLen; j += 1) {
        const searcher = searchers2[j];
        const { isMatch, indices, score } = searcher.search(text);
        if (isMatch) {
          numMatches += 1;
          totalScore += score;
          if (includeMatches) {
            const type = searcher.constructor.type;
            if (MultiMatchSet.has(type)) {
              allIndices = [...allIndices, ...indices];
            } else {
              allIndices.push(indices);
            }
          }
        } else {
          totalScore = 0;
          numMatches = 0;
          allIndices.length = 0;
          break;
        }
      }
      if (numMatches) {
        let result = {
          isMatch: true,
          score: totalScore / numMatches
        };
        if (includeMatches) {
          result.indices = allIndices;
        }
        return result;
      }
    }
    return {
      isMatch: false,
      score: 1
    };
  }
}
var registeredSearchers = [];
function register(...args) {
  registeredSearchers.push(...args);
}
function createSearcher(pattern, options) {
  for (let i = 0, len = registeredSearchers.length;i < len; i += 1) {
    let searcherClass = registeredSearchers[i];
    if (searcherClass.condition(pattern, options)) {
      return new searcherClass(pattern, options);
    }
  }
  return new BitapSearch(pattern, options);
}
var LogicalOperator = {
  AND: "$and",
  OR: "$or"
};
var KeyType = {
  PATH: "$path",
  PATTERN: "$val"
};
var isExpression = (query) => !!(query[LogicalOperator.AND] || query[LogicalOperator.OR]);
var isPath = (query) => !!query[KeyType.PATH];
var isLeaf = (query) => !isArray(query) && isObject(query) && !isExpression(query);
var convertToExplicit = (query) => ({
  [LogicalOperator.AND]: Object.keys(query).map((key) => ({
    [key]: query[key]
  }))
});
function parse(query, options, { auto = true } = {}) {
  const next = (query2) => {
    let keys = Object.keys(query2);
    const isQueryPath = isPath(query2);
    if (!isQueryPath && keys.length > 1 && !isExpression(query2)) {
      return next(convertToExplicit(query2));
    }
    if (isLeaf(query2)) {
      const key = isQueryPath ? query2[KeyType.PATH] : keys[0];
      const pattern = isQueryPath ? query2[KeyType.PATTERN] : query2[key];
      if (!isString(pattern)) {
        throw new Error(LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY(key));
      }
      const obj = {
        keyId: createKeyId(key),
        pattern
      };
      if (auto) {
        obj.searcher = createSearcher(pattern, options);
      }
      return obj;
    }
    let node = {
      children: [],
      operator: keys[0]
    };
    keys.forEach((key) => {
      const value = query2[key];
      if (isArray(value)) {
        value.forEach((item) => {
          node.children.push(next(item));
        });
      }
    });
    return node;
  };
  if (!isExpression(query)) {
    query = convertToExplicit(query);
  }
  return next(query);
}
function computeScore(results, { ignoreFieldNorm = Config.ignoreFieldNorm }) {
  results.forEach((result) => {
    let totalScore = 1;
    result.matches.forEach(({ key, norm: norm2, score }) => {
      const weight = key ? key.weight : null;
      totalScore *= Math.pow(score === 0 && weight ? Number.EPSILON : score, (weight || 1) * (ignoreFieldNorm ? 1 : norm2));
    });
    result.score = totalScore;
  });
}
function transformMatches(result, data) {
  const matches = result.matches;
  data.matches = [];
  if (!isDefined(matches)) {
    return;
  }
  matches.forEach((match) => {
    if (!isDefined(match.indices) || !match.indices.length) {
      return;
    }
    const { indices, value } = match;
    let obj = {
      indices,
      value
    };
    if (match.key) {
      obj.key = match.key.src;
    }
    if (match.idx > -1) {
      obj.refIndex = match.idx;
    }
    data.matches.push(obj);
  });
}
function transformScore(result, data) {
  data.score = result.score;
}
function format(results, docs, {
  includeMatches = Config.includeMatches,
  includeScore = Config.includeScore
} = {}) {
  const transformers = [];
  if (includeMatches)
    transformers.push(transformMatches);
  if (includeScore)
    transformers.push(transformScore);
  return results.map((result) => {
    const { idx } = result;
    const data = {
      item: docs[idx],
      refIndex: idx
    };
    if (transformers.length) {
      transformers.forEach((transformer) => {
        transformer(result, data);
      });
    }
    return data;
  });
}

class Fuse {
  constructor(docs, options = {}, index) {
    this.options = { ...Config, ...options };
    if (this.options.useExtendedSearch && false) {}
    this._keyStore = new KeyStore(this.options.keys);
    this.setCollection(docs, index);
  }
  setCollection(docs, index) {
    this._docs = docs;
    if (index && !(index instanceof FuseIndex)) {
      throw new Error(INCORRECT_INDEX_TYPE);
    }
    this._myIndex = index || createIndex(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(doc) {
    if (!isDefined(doc)) {
      return;
    }
    this._docs.push(doc);
    this._myIndex.add(doc);
  }
  remove(predicate = () => false) {
    const results = [];
    for (let i = 0, len = this._docs.length;i < len; i += 1) {
      const doc = this._docs[i];
      if (predicate(doc, i)) {
        this.removeAt(i);
        i -= 1;
        len -= 1;
        results.push(doc);
      }
    }
    return results;
  }
  removeAt(idx) {
    this._docs.splice(idx, 1);
    this._myIndex.removeAt(idx);
  }
  getIndex() {
    return this._myIndex;
  }
  search(query, { limit = -1 } = {}) {
    const {
      includeMatches,
      includeScore,
      shouldSort,
      sortFn,
      ignoreFieldNorm
    } = this.options;
    let results = isString(query) ? isString(this._docs[0]) ? this._searchStringList(query) : this._searchObjectList(query) : this._searchLogical(query);
    computeScore(results, { ignoreFieldNorm });
    if (shouldSort) {
      results.sort(sortFn);
    }
    if (isNumber(limit) && limit > -1) {
      results = results.slice(0, limit);
    }
    return format(results, this._docs, {
      includeMatches,
      includeScore
    });
  }
  _searchStringList(query) {
    const searcher = createSearcher(query, this.options);
    const { records } = this._myIndex;
    const results = [];
    records.forEach(({ v: text, i: idx, n: norm2 }) => {
      if (!isDefined(text)) {
        return;
      }
      const { isMatch, score, indices } = searcher.searchIn(text);
      if (isMatch) {
        results.push({
          item: text,
          idx,
          matches: [{ score, value: text, norm: norm2, indices }]
        });
      }
    });
    return results;
  }
  _searchLogical(query) {
    const expression = parse(query, this.options);
    const evaluate = (node, item, idx) => {
      if (!node.children) {
        const { keyId, searcher } = node;
        const matches = this._findMatches({
          key: this._keyStore.get(keyId),
          value: this._myIndex.getValueForItemAtKeyId(item, keyId),
          searcher
        });
        if (matches && matches.length) {
          return [
            {
              idx,
              item,
              matches
            }
          ];
        }
        return [];
      }
      const res = [];
      for (let i = 0, len = node.children.length;i < len; i += 1) {
        const child = node.children[i];
        const result = evaluate(child, item, idx);
        if (result.length) {
          res.push(...result);
        } else if (node.operator === LogicalOperator.AND) {
          return [];
        }
      }
      return res;
    };
    const records = this._myIndex.records;
    const resultMap = {};
    const results = [];
    records.forEach(({ $: item, i: idx }) => {
      if (isDefined(item)) {
        let expResults = evaluate(expression, item, idx);
        if (expResults.length) {
          if (!resultMap[idx]) {
            resultMap[idx] = { idx, item, matches: [] };
            results.push(resultMap[idx]);
          }
          expResults.forEach(({ matches }) => {
            resultMap[idx].matches.push(...matches);
          });
        }
      }
    });
    return results;
  }
  _searchObjectList(query) {
    const searcher = createSearcher(query, this.options);
    const { keys, records } = this._myIndex;
    const results = [];
    records.forEach(({ $: item, i: idx }) => {
      if (!isDefined(item)) {
        return;
      }
      let matches = [];
      keys.forEach((key, keyIndex) => {
        matches.push(...this._findMatches({
          key,
          value: item[keyIndex],
          searcher
        }));
      });
      if (matches.length) {
        results.push({
          idx,
          item,
          matches
        });
      }
    });
    return results;
  }
  _findMatches({ key, value, searcher }) {
    if (!isDefined(value)) {
      return [];
    }
    let matches = [];
    if (isArray(value)) {
      value.forEach(({ v: text, i: idx, n: norm2 }) => {
        if (!isDefined(text)) {
          return;
        }
        const { isMatch, score, indices } = searcher.searchIn(text);
        if (isMatch) {
          matches.push({
            score,
            key,
            value: text,
            idx,
            norm: norm2,
            indices
          });
        }
      });
    } else {
      const { v: text, n: norm2 } = value;
      const { isMatch, score, indices } = searcher.searchIn(text);
      if (isMatch) {
        matches.push({ score, key, value: text, norm: norm2, indices });
      }
    }
    return matches;
  }
}
Fuse.version = "7.1.0";
Fuse.createIndex = createIndex;
Fuse.parseIndex = parseIndex;
Fuse.config = Config;
{
  Fuse.parseQuery = parse;
}
{
  register(ExtendedSearch);
}

// src/search/fuzzy.ts
async function searchFuzzy(projectID, query, options = {}) {
  const threshold = options.threshold ?? 0.4;
  const limit = options.limit ?? 50;
  const items = [];
  for await (const session of listSessions(projectID)) {
    if (inDateRange(session.time.updated, options.dateRange)) {
      items.push({
        session,
        content: session.title,
        type: "title",
        timestamp: session.time.updated
      });
    }
    for await (const message of listMessages(session.id, options.role)) {
      if (!inDateRange(message.time.created, options.dateRange))
        continue;
      for await (const part of listParts(message.id)) {
        if (part.type === "text" && part.text) {
          items.push({
            session,
            content: part.text,
            type: "message",
            messageID: message.id,
            partID: part.id,
            timestamp: message.time.created
          });
        }
        if (part.type === "tool" && part.tool) {
          items.push({
            session,
            content: part.tool + " " + (part.state?.title || ""),
            type: "tool",
            messageID: message.id,
            partID: part.id,
            timestamp: message.time.created
          });
        }
        if (part.type === "tool" && part.state) {
          const inputStr = JSON.stringify(part.state.input || {});
          const outputStr = part.state.output || "";
          const combined = inputStr + " " + outputStr;
          const pathMatches = combined.match(/(?:\/[^/\s]+)+/g);
          if (pathMatches) {
            for (const path2 of pathMatches) {
              items.push({
                session,
                content: path2,
                type: "filepath",
                messageID: message.id,
                partID: part.id,
                timestamp: message.time.created
              });
            }
          }
        }
        if (part.type === "patch" && part.files) {
          for (const filePath of part.files) {
            items.push({
              session,
              content: filePath,
              type: "filepath",
              messageID: message.id,
              partID: part.id,
              timestamp: message.time.created
            });
          }
        }
      }
    }
  }
  const fuse = new Fuse(items, {
    keys: ["content"],
    threshold,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 2
  });
  const results = fuse.search(query, { limit });
  return results.map((result) => {
    const matchedText = result.matches?.[0]?.value || result.item.content;
    const matchIndex = result.matches?.[0]?.indices?.[0]?.[0] || 0;
    const contextStart = Math.max(0, matchIndex - 100);
    const contextEnd = Math.min(matchedText.length, matchIndex + 200);
    const context = matchedText.slice(contextStart, contextEnd);
    const excerptStart = Math.max(0, matchIndex - 20);
    const excerptEnd = Math.min(matchedText.length, matchIndex + 80);
    const excerpt = matchedText.slice(excerptStart, excerptEnd);
    return {
      sessionID: result.item.session.id,
      sessionTitle: result.item.session.title,
      timestamp: result.item.timestamp,
      matchType: result.item.type,
      excerpt: excerpt || query,
      context: context || excerpt,
      messageID: result.item.messageID,
      partID: result.item.partID,
      projectDirectory: result.item.session.directory
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}

// src/search/file-trace.ts
init_storage_sqlite();
function traceFileSqlite(db, projectID, queryPath, options) {
  const normalizedQuery = queryPath.replace(/\\/g, "/");
  const isExactPath = normalizedQuery.includes("/");
  const likePattern = `%${normalizedQuery}%`;
  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";
  const toolPath = (json) => `COALESCE(json_extract(${json}, '$.state.input.path'), json_extract(${json}, '$.state.input.filePath'))`;
  const partData = "(CASE WHEN json_valid(p.data) THEN p.data END)";
  const messageData = "(CASE WHEN json_valid(m.data) THEN m.data END)";
  const content = "(CASE WHEN c.type = 'object' THEN c.value END)";
  const sql = `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      s.directory AS directory,
      m.id AS message_id,
      m.time_created AS message_time,
      json_extract(${partData}, '$.name') AS tool_name,
      ${toolPath(partData)} AS matched_file_path_tool,
      NULL AS matched_files_patch,
      0 AS source_priority
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    JOIN session_part p ON p.message_id = m.id
    WHERE p.type = 'tool'
      AND json_extract(${partData}, '$.name') IN ('write', 'edit')
      AND ${toolPath(partData)} LIKE ?
      ${projectFilter}

    UNION ALL

    SELECT
      s.id, s.title, s.directory, m.id, m.time_created,
      json_extract(${content}, '$.name'),
      ${toolPath(content)},
      NULL,
      0
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    JOIN json_each(COALESCE(${messageData}, '{}'), '$.content') c
    WHERE json_extract(${content}, '$.type') = 'tool'
      AND json_extract(${content}, '$.name') IN ('write', 'edit')
      AND ${toolPath(content)} LIKE ?
      ${projectFilter}

    UNION ALL

    SELECT
      s.id, s.title, s.directory, m.id, m.time_created,
      NULL,
      NULL,
      json_extract(${messageData}, '$.snapshot.files'),
      1
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    WHERE json_extract(${messageData}, '$.snapshot.files') LIKE ?
      ${projectFilter}
    ORDER BY message_time DESC, source_priority ASC
  `;
  const binds = [0, 1, 2].flatMap(() => projectID !== null ? [likePattern, projectID] : [likePattern]);
  const rows = db.query(sql).all(...binds);
  const candidates = [];
  for (const row of rows) {
    let matchedPath = null;
    if (row.source_priority === 0 && row.matched_file_path_tool) {
      const toolPath2 = relativeTo(row.directory, row.matched_file_path_tool);
      if (isMatch(toolPath2, normalizedQuery, isExactPath)) {
        matchedPath = toolPath2;
      }
    } else if (row.source_priority === 1 && row.matched_files_patch) {
      try {
        const files = JSON.parse(row.matched_files_patch);
        if (Array.isArray(files)) {
          for (const f of files) {
            if (typeof f === "string" && isMatch(f, normalizedQuery, isExactPath)) {
              matchedPath = f;
              break;
            }
          }
        }
      } catch {
        continue;
      }
    }
    if (matchedPath) {
      candidates.push({
        sessionID: row.session_id,
        sessionTitle: row.session_title ?? "",
        messageID: row.message_id,
        timestamp: row.message_time,
        toolName: row.tool_name,
        filePath: matchedPath
      });
    }
  }
  const seen = new Set;
  const deduped = [];
  for (const c of candidates) {
    const key = `${c.sessionID}|${c.messageID}|${c.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }
  let earliestTime = Infinity;
  let earliestIndex = -1;
  for (let i = 0;i < deduped.length; i++) {
    const candidate = deduped[i];
    if (candidate && candidate.timestamp < earliestTime) {
      earliestTime = candidate.timestamp;
      earliestIndex = i;
    }
  }
  const findUserPrompt = db.query(`
    SELECT json_extract(data, '$.text') AS text
    FROM session_message
    WHERE session_id = ?
      AND type = 'user'
      AND time_created < ?
      AND json_valid(data)
    ORDER BY time_created DESC
    LIMIT 1
  `);
  const results = deduped.map((c, idx) => {
    const promptRow = findUserPrompt.get(c.sessionID, c.timestamp);
    return {
      sessionID: c.sessionID,
      sessionTitle: c.sessionTitle,
      timestamp: c.timestamp,
      firstTouch: idx === earliestIndex,
      userPrompt: promptRow ? promptRow.text : null,
      toolName: c.toolName,
      filePath: c.filePath
    };
  });
  const limit = options?.limit ?? 50;
  return results.filter((result) => inDateRange(result.timestamp, options?.dateRange)).slice(0, limit);
}
function relativeTo(directory, filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefix = directory.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}
function isMatch(path2, query, isExact) {
  if (isExact) {
    return path2 === query;
  }
  return path2 === query || path2.endsWith(`/${query}`);
}
async function traceFile(projectID, filePath, options) {
  const db = openDb();
  try {
    return traceFileSqlite(db, projectID, filePath, options);
  } finally {
    db.close();
  }
}

// src/search/multiterm-sql.ts
var contentText = (item) => `
  CASE json_extract(${item}, '$.type')
    WHEN 'text' THEN json_extract(${item}, '$.text')
    WHEN 'tool' THEN
      COALESCE(json_extract(${item}, '$.name'), '') || ' ' ||
      COALESCE(json_extract(${item}, '$.state.input'), '') || ' ' ||
      COALESCE((
        SELECT group_concat(json_extract(CASE WHEN o.type = 'object' THEN o.value END, '$.text'), ' ')
        FROM json_each(${item}, '$.state.content') o
      ), '')
  END`;
var joined = (parts) => `NULLIF(TRIM(${parts.map((part) => `COALESCE(${part}, '')`).join(" || ' ' || ")}), '')`;
var validData = "(CASE WHEN json_valid(data) THEN data END)";
var item = "(CASE WHEN c.type = 'object' THEN c.value END)";
var DOCUMENTS = `
  doc AS (
    SELECT session_id, message_id || ':' || ordinal AS part_id, ${contentText(validData)} AS text, time_created
    FROM session_part
    WHERE type IN ('text', 'tool')
    UNION ALL
    SELECT
      session_id,
      id AS part_id,
      ${joined([
  `json_extract(${validData}, '$.text')`,
  `(SELECT group_concat(${joined([
    `json_extract(${item}, '$.name')`,
    `json_extract(${item}, '$.source.uri')`
  ])}, ' ') FROM json_each(${validData}, '$.files') c)`
])} AS text,
      time_created
    FROM session_message
    WHERE type = 'user'
    UNION ALL
    SELECT
      session_id,
      id AS part_id,
      ${joined([
  `(SELECT group_concat(${contentText(item)}, ' ') FROM json_each(${validData}, '$.content') c)`,
  `(SELECT group_concat(CASE WHEN c.type = 'text' THEN c.value END, ' ')
          FROM json_each(${validData}, '$.snapshot.files') c)`
])} AS text,
      time_created
    FROM session_message
    WHERE type = 'assistant'
  )`;
function buildMultitermSql(terms, projectID, options) {
  if (terms.length === 0) {
    throw new Error("terms array must contain at least one term");
  }
  const conditions = terms.map((_, i) => `MAX(CASE WHEN d.text LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS match_${i}`).join(", ");
  const having = terms.map((_, i) => `match_${i} = 1`).join(" AND ");
  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";
  const dateFilter = options.dateRange ? "AND s.time_updated BETWEEN ? AND ?" : "";
  const sql = `
    WITH ${DOCUMENTS}
    SELECT s.id AS session_id, COALESCE(s.title, '') AS title, s.directory, s.time_updated, ${conditions}
    FROM session_v2 s
    JOIN doc d ON d.session_id = s.id
    WHERE 1=1
      ${projectFilter}
      ${dateFilter}
    GROUP BY s.id
    HAVING ${having}
    ORDER BY s.time_updated DESC
    LIMIT ${options.limit}
  `.trim();
  const binds = [];
  for (const term of terms) {
    const escaped = term.replace(/[%_\\]/g, "\\$&");
    binds.push(`%${escaped}%`);
    binds.push(`%${escaped}%`);
  }
  if (projectID !== null) {
    binds.push(projectID);
  }
  if (options.dateRange) {
    binds.push(options.dateRange.start.getTime(), options.dateRange.end.getTime());
  }
  return { sql, binds };
}
function searchMultitermSqlite(db, projectID, terms, options) {
  const { sql, binds } = buildMultitermSql(terms, projectID, {
    limit: options?.limit ?? 50,
    dateRange: options?.dateRange
  });
  const rows = db.query(sql).all(...binds);
  if (rows.length === 0) {
    return [];
  }
  const placeholder = rows.map(() => "?").join(",");
  const sqlFollow = `
    WITH ${DOCUMENTS}
    SELECT session_id, part_id, text
    FROM doc
    WHERE session_id IN (${placeholder}) AND text IS NOT NULL
    ORDER BY time_created ASC
  `;
  const followRows = db.query(sqlFollow).all(...rows.map((r) => r.session_id));
  const termHitsBySession = new Map;
  for (const row of followRows) {
    if (!termHitsBySession.has(row.session_id)) {
      termHitsBySession.set(row.session_id, new Map);
    }
    const sessionMap = termHitsBySession.get(row.session_id);
    if (sessionMap.size >= terms.length)
      continue;
    for (const term of terms) {
      if (sessionMap.has(term))
        continue;
      const lower = row.text.toLowerCase();
      const termLower = term.toLowerCase();
      if (lower.includes(termLower)) {
        const idx = lower.indexOf(termLower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(row.text.length, idx + termLower.length + 50);
        sessionMap.set(term, {
          partID: row.part_id,
          matchType: "data",
          excerpt: row.text.slice(start, end).replace(/\s+/g, " ")
        });
      }
    }
  }
  return rows.map((row) => ({
    sessionID: row.session_id,
    sessionTitle: row.title,
    timestamp: row.time_updated,
    projectDirectory: row.directory,
    termHits: termHitsBySession.get(row.session_id) ?? new Map
  }));
}
async function searchMultiterm(projectID, terms, options) {
  const { openDb: openDb2 } = await Promise.resolve().then(() => (init_storage_sqlite(), exports_storage_sqlite));
  const db = openDb2();
  try {
    return searchMultitermSqlite(db, projectID, terms, options);
  } finally {
    db.close();
  }
}

// src/format.ts
function formatResults(matches) {
  if (matches.length === 0) {
    return "No matches found in conversation history.";
  }
  const lines = [
    `Found ${matches.length} matches in conversation history:
`
  ];
  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];
    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Project: ${match.projectDirectory}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Match Type: ${match.matchType}`);
    lines.push(`- Excerpt: "${match.excerpt}"`);
    if (match.context && match.context !== match.excerpt) {
      lines.push(`- Context: ...${match.context}...`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}
function formatTraceResults(matches) {
  if (matches.length === 0) {
    return "No file trace matches found in conversation history.";
  }
  const lines = [
    `Found ${matches.length} file trace matches in conversation history:
`
  ];
  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];
    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Status: ${match.firstTouch ? "First seen" : "Later touch"}`);
    lines.push(`- File: ${match.filePath}`);
    if (match.toolName) {
      lines.push(`- Tool: ${match.toolName}`);
    }
    if (match.userPrompt) {
      lines.push(`- Preceding User Prompt: "${match.userPrompt}"`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}
function formatMultitermResults(matches) {
  if (matches.length === 0) {
    return "No sessions found in conversation history.";
  }
  const lines = [
    `Found ${matches.length} sessions in conversation history:
`
  ];
  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];
    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Project: ${match.projectDirectory}`);
    lines.push(`- Date: ${date} ${time}`);
    if (match.termHits.size > 0) {
      const termList = Array.from(match.termHits.keys()).join(", ");
      lines.push(`- Matched terms: ${termList}`);
      for (const [term, hit] of match.termHits) {
        lines.push(`  - ${term}: ${hit.excerpt}`);
      }
    }
    lines.push("");
  }
  return lines.join(`
`);
}

// src/index.ts
var PLUGIN_ID = "opencode-history-search";
var TOOL_NAME = "history-search";
var description = `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths.

THREE SEARCH MODES:
1. SINGLE-TERM (query): Pass query for one search term. Returns per-part matches. Use mode: "fuzzy" for typos, regex: true for patterns.
2. MULTI-TERM AND (terms): Pass terms: ["term1", "term2", ...] to find sessions containing ALL terms anywhere in the session (across title, messages, tools, file paths). Returns one result per session with per-term excerpts. Use when the user remembers multiple concepts (e.g., "find sessions about truck, vertex, and gemini"). Requires 2+ terms.
3. FILE TRACE (filePath): Pass filePath to find which sessions created or modified a specific file.

Supports keyword search, regex patterns, fuzzy search, multi-term AND search, date filtering, and role filtering.`;
var input = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath or terms is provided."
    },
    terms: {
      type: "array",
      items: { type: "string" },
      description: 'Array of terms for multi-term AND search. Returns sessions containing ALL terms anywhere in the session (title, messages, tools, file paths). Use when the user wants sessions matching multiple concepts (e.g., ["truck", "vertex", "gemini"]). Requires 2+ terms for multi-term path; 1 term falls back to single-term query. Case-insensitive substring matching.'
    },
    filePath: {
      type: "string",
      description: "File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored."
    },
    searchAllProjects: {
      type: "boolean",
      description: "Set to true to search ALL projects on this machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere."
    },
    mode: {
      type: "string",
      enum: ["keyword", "fuzzy"],
      description: "Search mode: 'keyword' for exact matches, 'fuzzy' for typo-tolerant matching (default: keyword)"
    },
    regex: {
      type: "boolean",
      description: "Treat query as regex pattern (keyword mode only, default: false)"
    },
    caseSensitive: {
      type: "boolean",
      description: "Case-sensitive search (keyword mode only, default: false)"
    },
    fuzzyThreshold: {
      type: "number",
      description: "Fuzzy match threshold 0.0-1.0 (fuzzy mode only, default: 0.4, lower = stricter)"
    },
    date: {
      type: "string",
      description: "Filter by date: 'today', 'yesterday', 'last N days/weeks/months', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY-MM-DD to YYYY-MM-DD'"
    },
    limit: {
      type: "number",
      description: "Maximum number of results (default: 50)"
    },
    role: {
      type: "string",
      enum: ["user", "assistant"],
      description: "Filter by message role: 'user' for your messages only, 'assistant' for AI responses only. Ignored if filePath is provided."
    }
  },
  additionalProperties: false
};
async function runSearch(args, currentProjectID) {
  if (!args.query && !args.filePath && !args.terms) {
    throw new Error("Either 'query', 'terms', or 'filePath' must be provided.");
  }
  const projectID = args.searchAllProjects ? null : currentProjectID;
  const dateRange = args.date ? parseDateFilter(args.date) : undefined;
  let query = args.query;
  if (args.terms !== undefined) {
    if (!Array.isArray(args.terms) || args.terms.length === 0) {
      throw new Error("'terms' must be a non-empty array of strings.");
    }
    if (args.terms.length > 1) {
      return formatMultitermResults(await searchMultiterm(projectID, args.terms, { limit: args.limit, dateRange }));
    }
    query = args.terms[0];
  }
  if (args.filePath) {
    return formatTraceResults(await traceFile(projectID, args.filePath, { limit: args.limit, dateRange }));
  }
  if (!query) {
    throw new Error("'query' is required when 'filePath' is not provided.");
  }
  const matches = args.mode === "fuzzy" ? await searchFuzzy(projectID, query, {
    threshold: args.fuzzyThreshold,
    limit: args.limit,
    role: args.role,
    dateRange
  }) : await searchKeyword(projectID, query, {
    regex: args.regex,
    caseSensitive: args.caseSensitive,
    limit: args.limit,
    role: args.role,
    dateRange
  });
  return formatResults(matches);
}
var plugin = {
  id: PLUGIN_ID,
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description,
        input,
        execute: async (args) => ({
          content: await runSearch(args, ctx.location.project.id)
        })
      });
    });
  }
};
var src_default = plugin;
export {
  runSearch,
  input,
  description,
  src_default as default,
  TOOL_NAME,
  PLUGIN_ID
};
