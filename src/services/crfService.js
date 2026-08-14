import { fetchCrfByActivityType, fetchCrfByNos } from "../features/crf/api/crfApi.js";
import { formatActivityTimepointLabel } from "../utils/visitDisplay";
import {
  applyReviewQueryResolved,
  isActiveReviewQuery
} from "./reviewQueryService";

/** @type {Map<string, object>} cache key → fill-ready definition */
const crfDefinitionCache = new Map();

function byTypeCacheKey(activityType) {
  return `byType:${String(activityType ?? "").trim().toLowerCase()}`;
}

function byNoCacheKey(appActivityCrfNo) {
  return `byNo:${Number(appActivityCrfNo) || 0}`;
}

function formatCrfDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Store ISO calendar date for native/date-part CRF controls (YYYY-MM-DD).
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCrfTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Flatten nested section/subsection/block field nodes (fields only). */
function flattenCrfItems(items, out = []) {
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind ?? "").toLowerCase();
    if ((kind === "field" || !kind) && item.field) {
      out.push({ ...item, kind: "field" });
      continue;
    }
    if ((kind === "section" || kind === "subsection") && Array.isArray(item.items)) {
      flattenCrfItems(item.items, out);
      continue;
    }
    if (Array.isArray(item.blocks)) {
      flattenCrfItems(item.blocks, out);
    }
  }
  return out;
}

function getCrfActiveFieldItems(definition) {
  return flattenCrfItems(definition?.items ?? []).filter(
    (item) => item.kind === "field" && item.field && item.field.active !== false
  );
}

/** Normalize a CRF items tree while preserving section / instruction structure (eCRF preview parity). */
function normalizeCrfItemTree(items) {
  return (items ?? [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const kind = String(item.kind ?? (item.field ? "field" : "")).toLowerCase();
      if (kind === "field" && item.field) {
        return {
          ...item,
          kind: "field",
          id: item.id || item.field.id || `field-${index}`,
          field: item.field,
        };
      }
      if (kind === "instruction") {
        return {
          ...item,
          kind: "instruction",
          id: item.id || `instruction-${index}`,
          title: item.title || "",
          html: item.html || item.content || item.text || "",
        };
      }
      if (kind === "subsection" || kind === "section") {
        const nested = Array.isArray(item.items)
          ? item.items
          : Array.isArray(item.blocks)
            ? item.blocks
            : [];
        return {
          ...item,
          kind,
          id: item.id || `${kind}-${index}`,
          name: item.name || (kind === "section" ? "Section" : "Subsection"),
          items: normalizeCrfItemTree(nested),
        };
      }
      if (kind === "datatable") {
        return { ...item, kind: "dataTable", id: item.id || `datatable-${index}` };
      }
      return null;
    })
    .filter(Boolean);
}

function itemsFromLegacySections(sections) {
  return (sections ?? []).map((sec, index) => {
    const nested = Array.isArray(sec?.blocks) && sec.blocks.length
      ? sec.blocks
      : (sec?.fields || []).map((field, fieldIndex) => ({
          kind: "field",
          id: field?.id || `field-${index}-${fieldIndex}`,
          field,
        }));
    return {
      kind: "section",
      id: sec?.id || `section-${index}`,
      name: sec?.name || "Section",
      hideHeader: sec?.hideHeader === true,
      items: nested,
    };
  });
}

/**
 * Build display sections in document order (matches WEB eCRF preview):
 * consecutive root-level fields/instructions become one untitled segment;
 * each section is its own titled block.
 */
function syncSectionsFromItems(items) {
  const sections = [];
  let rootBuf = [];
  let segIdx = 0;

  const flushRoot = () => {
    if (!rootBuf.length) return;
    sections.push({
      role: "root",
      id: `SEC-ROOT-${segIdx++}`,
      name: "",
      hideHeader: true,
      items: rootBuf,
    });
    rootBuf = [];
  };

  for (const it of items || []) {
    if (String(it.kind || "").toLowerCase() === "section") {
      flushRoot();
      sections.push({
        role: "section",
        id: it.id,
        name: it.name || "Section",
        hideHeader: it.hideHeader === true,
        items: it.items || [],
      });
    } else {
      rootBuf.push(it);
    }
  }
  flushRoot();
  return sections;
}

function mapApiDefinitionToFillShape(row) {
  if (!row) return null;
  const raw = row.definition && typeof row.definition === "object" ? row.definition : {};
  const activityType = String(row.activityType || "").trim();
  const templateId = String(row.crfTemplateId || raw.id || "").trim();
  const status = String(raw.status || "active").trim() || "active";
  const sourceItems = Array.isArray(raw.items) && raw.items.length > 0
    ? raw.items
    : itemsFromLegacySections(raw.sections);
  const items = normalizeCrfItemTree(sourceItems);
  return {
    id: templateId || activityType || String(raw.id ?? ""),
    name: String(row.crfName || raw.name || activityType || templateId || "CRF").trim(),
    description: String(raw.description ?? raw.name ?? "").trim(),
    status,
    fieldFlagOptions: Array.isArray(raw.fieldFlagOptions) ? raw.fieldFlagOptions : [],
    items,
    appActivityCrfNo: Number(row.appActivityCrfNo) || 0,
    version: Number(row.version) || 1,
    activityType,
    crfTemplateId: templateId,
    isActive: row.isActive !== false
  };
}

function putDefinitionInCache(definition) {
  if (!definition) return;
  const no = Number(definition.appActivityCrfNo) || 0;
  if (no > 0) {
    crfDefinitionCache.set(byNoCacheKey(no), definition);
  }
  const type = String(definition.activityType ?? "").trim();
  // Only latest-by-type lookups use the type key; still cache active defs under type for unpinned fills.
  if (type && definition.isActive !== false) {
    crfDefinitionCache.set(byTypeCacheKey(type), definition);
  }
}

function getCachedCrfDefinitionByNo(appActivityCrfNo) {
  const no = Number(appActivityCrfNo) || 0;
  if (no <= 0) return null;
  return crfDefinitionCache.get(byNoCacheKey(no)) ?? null;
}

function getCachedCrfDefinition(activityType) {
  const key = byTypeCacheKey(activityType);
  if (!String(activityType ?? "").trim()) return null;
  return crfDefinitionCache.get(key) ?? null;
}

/** @deprecated Prefer putDefinitionInCache; kept for callers that only know activity type. */
function cacheCrfDefinition(activityType, definition) {
  if (!definition) return;
  const withType = {
    ...definition,
    activityType: definition.activityType || activityType
  };
  putDefinitionInCache(withType);
}

async function ensureCrfDefinitionLoaded(activityType) {
  const key = String(activityType ?? "").trim();
  if (!key) return null;
  const cached = getCachedCrfDefinition(key);
  if (cached) return cached;
  try {
    const row = await fetchCrfByActivityType(key);
    const definition = mapApiDefinitionToFillShape(row);
    if (definition && getCrfActiveFieldItems(definition).length > 0) {
      putDefinitionInCache(definition);
      return definition;
    }
  } catch {
    return null;
  }
  return null;
}

async function ensureCrfDefinitionsByNosLoaded(appActivityCrfNos = []) {
  const nos = [...new Set(
    (Array.isArray(appActivityCrfNos) ? appActivityCrfNos : [])
      .map((n) => Number(n) || 0)
      .filter((n) => n > 0)
  )];
  const missing = nos.filter((n) => !getCachedCrfDefinitionByNo(n));
  if (!missing.length) {
    return nos.map((n) => getCachedCrfDefinitionByNo(n)).filter(Boolean);
  }
  try {
    const rows = await fetchCrfByNos(missing);
    for (const row of rows) {
      const definition = mapApiDefinitionToFillShape(row);
      if (definition && getCrfActiveFieldItems(definition).length > 0) {
        putDefinitionInCache(definition);
      } else if (definition) {
        // Keep empty defs cached by no so hydrate can still attach version metadata.
        putDefinitionInCache(definition);
      }
    }
  } catch {
    // Fall through — callers may still have type-based latest.
  }
  return nos.map((n) => getCachedCrfDefinitionByNo(n)).filter(Boolean);
}

/**
 * Load CRF definitions for unique activity.activity (activity type) values and attach onto activities.
 */
async function hydrateCrfDefinitionsInState(state) {
  const activities = state?.activities ?? [];
  const hydrated = await hydrateCrfDefinitionsForActivities(activities);
  return {
    ...state,
    activities: hydrated
  };
}

/**
 * Load DB CRF definitions for the given activities and attach `crfDefinition` when fields exist.
 * Pinned `appActivityCrfNo` → that snapshot (incl. inactive). Unpinned → latest active by type.
 */
async function hydrateCrfDefinitionsForActivities(activities = []) {
  const list = Array.isArray(activities) ? activities : [];

  const pinnedNos = [
    ...new Set(
      list
        .map((a) => Number(a.appActivityCrfNo) || 0)
        .filter((n) => n > 0)
    )
  ];
  await ensureCrfDefinitionsByNosLoaded(pinnedNos);

  // Only unpinned activities may load latest-by-type. Never prime latest when a pin exists.
  const activityTypesNeedingLatest = [
    ...new Set(
      list
        .filter((a) => !(Number(a.appActivityCrfNo) > 0))
        .map((a) => String(a.activity ?? "").trim())
        .filter(Boolean)
    )
  ];
  await Promise.all(activityTypesNeedingLatest.map((type) => ensureCrfDefinitionLoaded(type)));

  return list.map((activity) => {
    const activityType = String(activity.activity ?? "").trim();
    const pinnedNo = Number(activity.appActivityCrfNo) || 0;
    let definition = null;

    if (pinnedNo > 0) {
      definition = getCachedCrfDefinitionByNo(pinnedNo);
      // Keep the saved pin even if snapshot is temporarily missing — never stamp latest over it.
      if (!definition) {
        return {
          ...activity,
          appActivityCrfNo: pinnedNo,
          crfDefinition: undefined
        };
      }
    } else if (activityType) {
      definition = getCachedCrfDefinition(activityType);
    }

    if (!definition) {
      return activity;
    }

    // Pinned historical defs may be inactive; still attach for version + answers.
    const hasFields = getCrfActiveFieldItems(definition).length > 0;
    if (!hasFields && !(pinnedNo > 0)) {
      return activity;
    }

    const next = {
      ...activity,
      crfDefinition: definition,
      appActivityCrfNo: pinnedNo > 0 ? pinnedNo : (definition.appActivityCrfNo || null),
      crfVersion: pinnedNo > 0
        ? (definition.version ?? activity.crfVersion ?? null)
        : (activity.crfVersion ?? definition.version ?? null),
      crfName: pinnedNo > 0
        ? (definition.name || activity.crfName || null)
        : (activity.crfName || definition.name || null)
    };
    const crfValues = activity.crfValues && typeof activity.crfValues === "object"
      ? activity.crfValues
      : null;
    if (crfValues && Object.keys(crfValues).length > 0) {
      const existing = next.crfResponses?.[definition.id]?.values ?? {};
      next.crfResponses = {
        ...(next.crfResponses ?? {}),
        [definition.id]: {
          values: { ...crfValues, ...existing },
          savedAt: next.crfResponses?.[definition.id]?.savedAt ?? new Date().toISOString()
        }
      };
    }
    return next;
  });
}

function activityHasCrf(activity) {
  const pinnedNo = Number(activity?.appActivityCrfNo) || 0;
  const definition = getCrfDefinitionForActivity(activity);
  if (!definition) return false;
  // Historical (inactive) pinned CRFs remain viewable/editable for that timepoint.
  if (definition.status && definition.status !== "active" && !(pinnedNo > 0)) {
    return false;
  }
  // Pinned defs: allow open even if field-item filter is empty (still show version/answers).
  if (pinnedNo > 0) {
    return true;
  }
  return getCrfActiveFieldItems(definition).length > 0;
}

/** Skipped/Missed timepoints never get a CRF (nothing was collected). */
function isCrfDisabledForActivity(activity) {
  return ["Skipped", "Missed"].includes(String(activity?.status ?? ""));
}

/** CRF fill is allowed only after the timepoint/dose has an actual time recorded. */
function isActivityReadyForCrf(activity) {
  if (!activity) return false;
  if (isCrfDisabledForActivity(activity)) return false;
  if (activity.actualTime) return true;
  return ["Completed", "Deviation"].includes(String(activity.status ?? ""));
}

function getCrfNotReadyMessage(activity) {
  if (isCrfDisabledForActivity(activity)) {
    return "CRF is not applicable for a skipped timepoint.";
  }
  if (activity?.activity === "IMP Dose Administration") {
    return "Set actual dose time before filling CRF.";
  }
  return "Complete the timepoint (set actual time) before filling CRF.";
}

function getCrfDefinitionForActivity(activity) {
  if (!activity) return null;

  const pinnedNo = Number(activity.appActivityCrfNo) || 0;
  if (pinnedNo > 0) {
    const byPin = getCachedCrfDefinitionByNo(pinnedNo);
    if (byPin) {
      return byPin;
    }
    // Pin set: only accept attached definition when it is the same pin. Never use latest-by-type.
    if (activity.crfDefinition) {
      const attachedNo = Number(activity.crfDefinition.appActivityCrfNo) || 0;
      if (attachedNo === pinnedNo) {
        return activity.crfDefinition;
      }
    }
    return null;
  }

  if (activity.crfDefinition && getCrfActiveFieldItems(activity.crfDefinition).length > 0) {
    return activity.crfDefinition;
  }

  const activityType = String(activity.activity ?? "").trim();
  if (activityType) {
    const cached = getCachedCrfDefinition(activityType);
    if (cached) return cached;
  }

  return null;
}

function getDoseReferenceTime(activity, visit) {
  return activity?.actualTime ?? visit?.actualDoseTime ?? visit?.plannedDoseTime ?? null;
}

/** WEB parity: countryRegion scope from timeRole / autoFetchConfig.
 * Project/site scopes use codes (header convention), not descriptions.
 */
function resolveCountryRegionAutoFetchValue(activity, autoFetchConfig = 0) {
  let scope = 0;
  if (autoFetchConfig === "site" || autoFetchConfig === "Site") scope = 1;
  else if (
    autoFetchConfig === "country"
    || autoFetchConfig === "Country"
    || autoFetchConfig === "Country/Region"
    || autoFetchConfig === "countryRegion"
  ) {
    scope = 2;
  } else if (autoFetchConfig === "project" || autoFetchConfig === "Project") scope = 3;
  else if (autoFetchConfig === "user" || autoFetchConfig === "User") scope = 4;
  else scope = Number(autoFetchConfig) || 0;

  const countryRegion = [activity?.country, activity?.region]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" / ");
  if (scope === 1) {
    return String(activity?.siteNo || activity?.siteName || "").trim();
  }
  if (scope === 2) {
    return countryRegion || String(activity?.siteNo || activity?.siteName || "").trim();
  }
  if (scope === 3) {
    return String(activity?.projectCode || activity?.projectName || "").trim();
  }
  if (scope === 4) {
    return String(activity?.userName || activity?.user || "").trim();
  }
  return countryRegion || String(activity?.siteNo || activity?.siteName || "").trim();
}

function isAutoFetchEnabled(autoFetch) {
  if (!autoFetch || typeof autoFetch !== "object") return false;
  const en = autoFetch.enabled;
  return en === true || en === 1 || en === "1" || String(en).toLowerCase() === "true";
}

function lookupMapValue(map, key) {
  if (!map || typeof map !== "object" || !key) return "";
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    return map[key] == null ? "" : String(map[key]);
  }
  const keyStr = String(key);
  const keys = Object.keys(map);
  // Exact prefix either direction (8-char designer refs / full UUID answers).
  let hit = keys.find((k) => k.startsWith(keyStr) || keyStr.startsWith(k));
  if (!hit && keyStr.length >= 8) {
    const prefix = keyStr.slice(0, 8).toLowerCase();
    hit = keys.find((k) => String(k).slice(0, 8).toLowerCase() === prefix);
  }
  if (hit) return map[hit] == null ? "" : String(map[hit]);
  return "";
}

function resolveLabelFromCrfAutoValue(field, activity) {
  const fieldId = String(field?.id || "").trim();
  const map = activity?.labelFromCrfValues;
  const byConsumer = lookupMapValue(map, fieldId);
  if (byConsumer) return byConsumer;

  // Same map may also be keyed by source refFieldId from the field's autoFetch JSON.
  const refFieldId = String(field?.autoFetch?.refFieldId || "").trim();
  if (refFieldId) {
    const byRef = lookupMapValue(map, refFieldId);
    if (byRef) return byRef;
  }
  return "";
}

function resolveFieldAutoValue(field, activity, sample, visit) {
  const autoFetch = field.autoFetch;
  const doseReferenceTime = getDoseReferenceTime(activity, visit);
  const actualTime = activity?.actualTime ?? sample?.collectedAt ?? null;
  const source = String(autoFetch?.source || autoFetch?.scheduleAnchor || "").trim();
  const enabled = isAutoFetchEnabled(autoFetch);

  if (field.type === "pk-label-auto") {
    return sample?.barcode ?? activity?.barcode ?? "";
  }

  // Driven only by field.autoFetch from CRF JSON (source / timeRole / scheduleAnchor).
  // ageCalculation is computed in dependency reactions, not as a static seed.
  if (enabled) {
    if (source === "visitName") {
      return activity?.visitLabel ?? visit?.label ?? "";
    }
    if (source === "screeningNo") {
      return String(activity?.screeningNo || "").trim();
    }
    if (source === "randomizationNo") {
      // Same subject id used across the app (site randomization no, e.g. 101-01).
      return String(
        activity?.siteRandomizationNo
          || activity?.randomizationNo
          || ""
      ).trim();
    }
    if (source === "siteName") {
      return String(activity?.siteNo || activity?.siteName || "").trim();
    }
    if (source === "projectName") {
      return String(activity?.projectCode || activity?.projectName || "").trim();
    }
    if (source === "countryRegion") {
      const cfg = autoFetch;
      const scope =
        cfg.timeRole && cfg.timeRole !== "countryRegion"
          ? cfg.timeRole
          : cfg.autoFetchConfig;
      return resolveCountryRegionAutoFetchValue(activity, scope);
    }
    if (source === "labelFromCrf") {
      return resolveLabelFromCrfAutoValue(field, activity);
    }
    if (source === "ageCalculation" || source.startsWith("ageCalc:")) {
      return "";
    }
  }

  if (!enabled) {
    if (autoFetch?.scheduleAnchor === "doseDate" && doseReferenceTime) {
      return formatCrfDate(doseReferenceTime);
    }
    if (autoFetch?.scheduleAnchor === "doseTime" && doseReferenceTime) {
      return formatCrfTime(doseReferenceTime);
    }
    return "";
  }

  if (autoFetch.scheduleAnchor === "doseDate" || source === "doseDate") {
    return doseReferenceTime ? formatCrfDate(doseReferenceTime) : "";
  }

  if (autoFetch.scheduleAnchor === "doseTime" || source === "doseTime") {
    return doseReferenceTime ? formatCrfTime(doseReferenceTime) : "";
  }

  if (autoFetch.scheduleAnchor === "actualDate" || (field.type === "date" && source === "actualTime")) {
    return actualTime ? formatCrfDate(actualTime) : "";
  }

  if (autoFetch.timeRole === "actualTime" || source === "actualTime") {
    return actualTime ? formatCrfTime(actualTime) : "";
  }

  if (source === "openLocalTime") {
    const now = new Date();
    return formatCrfTime(now.toISOString());
  }

  return "";
}

function buildCrfInitialValues(definition, activity, sample, savedValues = {}, visit) {
  const values = {};
  for (const item of getCrfActiveFieldItems(definition)) {
    const field = item.field;
    if (!field?.id) continue;
    const saved = savedValues[field.id];
    const hasSaved = saved !== undefined && saved !== null && String(saved).trim() !== "";
    // WEB-style: re-seed autofetch when saved value is empty (context RO fields).
    values[field.id] = hasSaved
      ? saved
      : resolveFieldAutoValue(field, activity, sample, visit);
  }
  return values;
}

function validateCrfValues(definition, values) {
  // Lazy import avoided — keep validate self-contained for callers that only need required checks.
  // Runtime dependency/validation lives in crfFieldRuntime when CrfForm calls it.
  const errors = {};
  for (const item of getCrfActiveFieldItems(definition)) {
    const field = item.field;
    if (!field) continue;
    const value = String(values[field.id] ?? "").trim();
    if (field.required && !value) {
      errors[field.id] = `${field.label} is required.`;
    }
  }
  return errors;
}

/**
 * For a visit/dose: find missing required CRF fields on completed (non-skipped) timepoints.
 * Non-required fields are ignored.
 */
function getMissingRequiredCrfIssues(state, visitId) {
  const issues = [];
  const activities = (state?.activities ?? []).filter((activity) => activity.visitId === visitId);
  const visitsById = new Map((state?.visits ?? []).map((visit) => [visit.id, visit]));

  for (const activity of activities) {
    if (isCrfDisabledForActivity(activity)) continue;
    if (!activityHasCrf(activity)) continue;
    // Only require CRF after the timepoint is actually completed / has actual time.
    if (!isActivityReadyForCrf(activity)) continue;

    const definition = getCrfDefinitionForActivity(activity);
    if (!definition) continue;

    const sample = (state?.samples ?? []).find(
      (item) => item.activityId === activity.id || (activity.sampleId && item.id === activity.sampleId)
    );
    const visit = visitsById.get(activity.visitId);
    const savedValues = resolveCrfSavedValues(activity, definition);
    const values = buildCrfInitialValues(definition, activity, sample, savedValues, visit);
    const fieldErrors = validateCrfValues(definition, values);
    for (const message of Object.values(fieldErrors)) {
      issues.push({
        activityId: activity.id,
        timepoint: formatActivityTimepointLabel(activity),
        dose: activity.dose,
        message
      });
    }
  }

  return issues;
}

function getMissingRequiredCrfSubmitMessage(state, visitId) {
  const issues = getMissingRequiredCrfIssues(state, visitId);
  if (!issues.length) return "";

  const first = issues[0];
  const more = issues.length > 1 ? ` and ${issues.length - 1} more required field(s)` : "";
  return `Complete required CRF fields before submit. ${first.timepoint}: ${first.message}${more}.`;
}

function getCrfFieldDefinition(definition, fieldId) {
  return getCrfActiveFieldItems(definition).find(
    (item) => item.field?.id === fieldId
  )?.field ?? null;
}

function getCrfFieldOldValue(field, activity, sample, visit, previousSaved = {}) {
  return previousSaved[field.id] !== undefined && previousSaved[field.id] !== null
    ? String(previousSaved[field.id])
    : String(resolveFieldAutoValue(field, activity, sample, visit) ?? "");
}

/**
 * Merge CRF answers from all known keys (template id, activity type, flat crfValues).
 */
function resolveCrfSavedValues(activity, definition) {
  if (!activity) return {};
  const responses = activity.crfResponses ?? {};
  const keys = [
    definition?.id,
    definition?.crfTemplateId,
    activity.crfDefinition?.id,
    activity.activity,
    activity.appActivityCrfNo ? String(activity.appActivityCrfNo) : null
  ].filter(Boolean);

  const merged = { ...(activity.crfValues ?? {}) };
  for (const key of keys) {
    const values = responses[key]?.values;
    if (values && typeof values === "object") {
      Object.assign(merged, values);
    }
  }
  // Any other response bags (legacy keys).
  for (const bag of Object.values(responses)) {
    if (bag?.values && typeof bag.values === "object") {
      Object.assign(merged, bag.values);
    }
  }
  return merged;
}

/** Any field where the submitted value differs from the previous/auto value. */
function getCrfValueChanges(definition, activity, sample, visit, previousSaved = {}, values = {}) {
  const changes = [];
  for (const item of getCrfActiveFieldItems(definition)) {
    const field = item.field;
    if (!field?.id) continue;
    const oldValue = getCrfFieldOldValue(field, activity, sample, visit, previousSaved);
    const newValue = String(values[field.id] ?? "");
    if (oldValue !== newValue) {
      changes.push({ fieldId: field.id, field, oldValue, newValue });
    }
  }
  return changes;
}

/**
 * Fields that already had a non-empty value and were edited — these need a change remark.
 * First-time fills (empty → value) are changes but not "updates".
 */
function getCrfFieldUpdates(definition, activity, sample, visit, previousSaved = {}, values = {}) {
  return getCrfValueChanges(definition, activity, sample, visit, previousSaved, values).filter(
    (change) => change.oldValue.trim() !== ""
  );
}

function resolveCrfQueryOnSave(state, activityId, fieldKey, responseText) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity || !isActiveReviewQuery(activity, fieldKey)) return state;
  const resolved = applyReviewQueryResolved(activity, fieldKey, responseText);
  if (resolved === activity) return state;
  return {
    ...state,
    activities: state.activities.map((item) => (item.id === activityId ? resolved : item))
  };
}

/**
 * Build API payload: only filled values, plus intentional clears of previously saved fields.
 * Never invent empty keys for never-filled optional fields (avoids wiping siblings on upsert).
 */
function pickCrfPersistValues(previousSaved = {}, values = {}) {
  const persist = {};
  for (const [fieldId, raw] of Object.entries(values ?? {})) {
    const next = String(raw ?? "");
    const prev = previousSaved[fieldId];
    const hadSaved = prev !== undefined && prev !== null && String(prev).trim() !== "";
    if (next.trim() !== "") {
      persist[fieldId] = next;
    } else if (hadSaved) {
      persist[fieldId] = "";
    }
  }
  return persist;
}

function saveActivityCrfField(state, activityId, crfId, fieldId, value, changeReason) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return { state, error: "Activity not found.", persistValues: null };
  if (!isActivityReadyForCrf(activity)) {
    return { state, error: getCrfNotReadyMessage(activity), persistValues: null };
  }

  const definition = getCrfDefinitionForActivity(activity);
  const field = getCrfFieldDefinition(definition, fieldId);
  if (!field) return { state, error: "CRF field not found.", persistValues: null };

  const previousSaved = resolveCrfSavedValues(activity, definition);
  const sample = state.samples.find(
    (item) => item.activityId === activityId || (activity.sampleId && item.id === activity.sampleId)
  );
  const visit = state.visits.find((item) => item.id === activity.visitId);
  // Merge only real saved keys + this edit — do not pad every definition field with "".
  const nextValues = { ...previousSaved, [fieldId]: value };
  const fieldErrors = validateCrfValues(
    { items: [{ kind: "field", field }] },
    nextValues
  );
  if (fieldErrors[fieldId]) return { state, error: fieldErrors[fieldId], persistValues: null };

  const oldValue = getCrfFieldOldValue(field, activity, sample, visit, previousSaved);
  const newValue = String(value ?? "");
  const isUpdate = oldValue.trim() !== "";
  const activeQuery = isActiveReviewQuery(activity, `crf:${fieldId}`);
  const valueChanged = oldValue !== newValue;
  if (!valueChanged && !activeQuery) {
    return { state, error: "No value changed. Please change the value before saving.", persistValues: null };
  }
  if ((isUpdate || activeQuery) && !String(changeReason ?? "").trim()) {
    return {
      state,
      error: activeQuery
        ? "Response comment is required before resolving query."
        : "Remark is required before updating this field.",
      persistValues: null
    };
  }

  const persistValues = { [fieldId]: newValue };
  const baseState = valueChanged
    ? {
        ...state,
        activities: state.activities.map((item) => {
          if (item.id !== activityId) return item;
          return {
            ...item,
            crfResponses: {
              ...(item.crfResponses ?? {}),
              [crfId]: {
                values: nextValues,
                savedAt: new Date().toISOString()
              }
            }
          };
        })
      }
    : state;

  return {
    state: resolveCrfQueryOnSave(baseState, activityId, `crf:${fieldId}`, changeReason),
    error: null,
    persistValues
  };
}

function saveActivityCrfResponse(state, activityId, crfId, values, changeReason) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return { state, error: "Activity not found.", persistValues: null };
  if (!isActivityReadyForCrf(activity)) {
    return { state, error: getCrfNotReadyMessage(activity), persistValues: null };
  }

  const definition = getCrfDefinitionForActivity(activity);
  if (!definition) return { state, error: "CRF definition not found.", persistValues: null };

  const previousSaved = resolveCrfSavedValues(activity, definition);
  const sample = state.samples.find(
    (item) => item.activityId === activityId || (activity.sampleId && item.id === activity.sampleId)
  );
  const visit = state.visits.find((item) => item.id === activity.visitId);
  const fieldErrors = validateCrfValues(definition, values);
  if (Object.keys(fieldErrors).length) {
    return { state, error: Object.values(fieldErrors)[0], persistValues: null };
  }

  const changes = getCrfValueChanges(definition, activity, sample, visit, previousSaved, values);
  const updates = getCrfFieldUpdates(definition, activity, sample, visit, previousSaved, values);
  const activeQueryFieldIds = getCrfActiveFieldItems(definition)
    .map((item) => item.field?.id)
    .filter((fieldId) => fieldId && isActiveReviewQuery(activity, `crf:${fieldId}`));
  const resolvingQuery = activeQueryFieldIds.length > 0;

  const changeReasonsByFieldId =
    changeReason && typeof changeReason === "object" && !Array.isArray(changeReason)
      ? Object.fromEntries(
          Object.entries(changeReason)
            .map(([k, v]) => [String(k), String(v ?? "").trim()])
            .filter(([k, v]) => k && v)
        )
      : null;
  const changeReasonText =
    typeof changeReason === "string"
      ? String(changeReason || "").trim()
      : "";
  const hasAnyChangeReason =
    changeReasonText.length > 0
    || (changeReasonsByFieldId && Object.keys(changeReasonsByFieldId).length > 0);

  if (updates.length > 0 && !hasAnyChangeReason) {
    return { state, error: "Remark is required before updating CRF values.", persistValues: null };
  }
  if (resolvingQuery && !hasAnyChangeReason) {
    return { state, error: "Response comment is required before resolving query.", persistValues: null };
  }
  if (updates.length > 0 && changeReasonsByFieldId) {
    const missing = updates.find(
      (update) => !String(changeReasonsByFieldId[update.fieldId] || "").trim()
    );
    if (missing) {
      const label = missing.field?.label || missing.fieldId || "a field";
      return {
        state,
        error: `Enter a reason for each changed field (missing: ${label}).`,
        persistValues: null,
      };
    }
  }

  if (changes.length === 0 && !resolvingQuery) {
    return { state, error: "No value changed. Please change a value before saving.", persistValues: null };
  }

  // Only filled fields (and intentional clears) — skip empty never-filled optionals.
  const persistValues = pickCrfPersistValues(previousSaved, values);
  if (Object.keys(persistValues).length === 0 && !resolvingQuery) {
    return { state, error: "No value changed. Please change a value before saving.", persistValues: null };
  }
  const nextValues = { ...previousSaved, ...persistValues };

  const fieldsToResolve = activeQueryFieldIds.filter((fieldId) => {
    const changed = changes.some((change) => change.fieldId === fieldId);
    return changed || activeQueryFieldIds.length === 1;
  });

  const baseState = {
    ...state,
    activities: state.activities.map((item) => {
      if (item.id !== activityId) return item;
      return {
        ...item,
        crfResponses: {
          ...(item.crfResponses ?? {}),
          [crfId]: {
            values: nextValues,
            savedAt: new Date().toISOString()
          }
        }
      };
    })
  };

  let nextState = baseState;
  for (const fieldId of fieldsToResolve) {
    const fieldReason =
      (changeReasonsByFieldId && changeReasonsByFieldId[fieldId])
      || changeReasonText;
    nextState = resolveCrfQueryOnSave(nextState, activityId, `crf:${fieldId}`, fieldReason);
  }

  return {
    state: nextState,
    error: null,
    persistValues
  };
}

export {
  activityHasCrf,
  buildCrfInitialValues,
  ensureCrfDefinitionLoaded,
  flattenCrfItems,
  formatCrfDate,
  formatCrfTime,
  getCachedCrfDefinition,
  getCrfActiveFieldItems,
  getCrfDefinitionForActivity,
  getCrfFieldOldValue,
  getCrfFieldUpdates,
  getCrfNotReadyMessage,
  getMissingRequiredCrfIssues,
  getMissingRequiredCrfSubmitMessage,
  hydrateCrfDefinitionsInState,
  hydrateCrfDefinitionsForActivities,
  getCachedCrfDefinitionByNo,
  ensureCrfDefinitionsByNosLoaded,
  isActivityReadyForCrf,
  isCrfDisabledForActivity,
  resolveCrfSavedValues,
  resolveFieldAutoValue,
  saveActivityCrfField,
  saveActivityCrfResponse,
  syncSectionsFromItems,
  validateCrfValues
};
