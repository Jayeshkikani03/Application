import * as XLSX from "xlsx";

function padNumber(value, length) {
  return String(value).padStart(length, "0");
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readCellValue(row, aliases) {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeHeader(key);
    if (aliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias))) {
      return value;
    }
  }
  return "";
}

function parseOffset(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function formatPeriodLabel(rawValue, index) {
  const text = String(rawValue ?? "").trim();
  if (!text) return `Period ${index}`;
  if (/^period\s*\d+$/i.test(text)) return text.replace(/\s+/g, " ");
  if (/^\d+$/.test(text)) return `Period ${Number(text)}`;
  return text;
}

function buildPeriodCode(index) {
  return padNumber(index, 2);
}

function parseScheduleRows(rows) {
  const periodMap = new Map();

  rows.forEach((row) => {
    const periodValue = readCellValue(row, ["period", "periodname", "periodlabel"]);
    const doseValue = readCellValue(row, ["dose", "doselabel"]);
    const timepointValue = readCellValue(row, ["timepoint", "timepointname", "timepointlabel"]);
    const offsetValue = readCellValue(row, ["offset", "offsetmin", "pkoffsetminutes", "minutes"]);

    if (!periodValue || !timepointValue) return;

    const periodKey = String(periodValue).trim().toLowerCase();
    if (!periodMap.has(periodKey)) {
      const index = periodMap.size + 1;
      periodMap.set(periodKey, {
        id: `period-${index}`,
        code: buildPeriodCode(index),
        label: formatPeriodLabel(periodValue, index),
        entries: [],
      });
    }

    periodMap.get(periodKey).entries.push({
      doseLabel: String(doseValue || "Dose").trim(),
      label: String(timepointValue).trim(),
      offset: parseOffset(offsetValue),
    });
  });

  const periods = [...periodMap.values()];
  if (periods.length === 0) {
    throw new Error("No period and timepoint rows were found in the Excel file.");
  }

  periods.forEach((period) => {
    if (period.entries.length === 0) {
      throw new Error(`${period.label} does not contain any timepoints.`);
    }
    period.doseLabels = [...new Set(period.entries.map((entry) => entry.doseLabel))];
    period.entries = period.entries.map((entry, index) => ({
      ...entry,
      order: index + 1,
    }));
  });

  return { periods };
}

function parseWorkbook(workbook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The Excel file does not contain any worksheets.");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const configRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let expectedPeriodCount = null;
  configRows.slice(0, 5).forEach((row) => {
    const label = String(row[0] ?? "").trim().toLowerCase();
    if (label.includes("number of period")) {
      const count = Number(row[1]);
      if (Number.isInteger(count) && count > 0) expectedPeriodCount = count;
    }
  });

  const schedule = parseScheduleRows(rows);
  if (expectedPeriodCount !== null && schedule.periods.length !== expectedPeriodCount) {
    throw new Error(`Excel lists ${expectedPeriodCount} period(s), but ${schedule.periods.length} were found in the schedule rows.`);
  }

  return schedule;
}

function parseProjectScheduleFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        resolve(parseWorkbook(workbook));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Unable to read the Excel file."));
      }
    };
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsArrayBuffer(file);
  });
}

export {
  parseProjectScheduleFile,
  parseScheduleRows,
};
