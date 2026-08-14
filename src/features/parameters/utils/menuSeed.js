import { DEFAULT_MENU_SEED } from "@/config/appMenuConfig.js";
import { operationsApi } from "../api/operationsApi";

async function saveOperationPayload(payload) {
  const saved = await operationsApi.saveOperation(payload);
  return saved?.operationMasterNo ?? saved?.data?.operationMasterNo ?? null;
}

function findByPath(allOps, path) {
  return allOps.find((o) => o.path === path) ?? null;
}

function findParentByName(allOps, name) {
  return allOps.find(
    (o) => o.isParent && o.menuGroup?.trim().toLowerCase() === name.trim().toLowerCase()
  ) ?? null;
}

async function upsertMenuItem({
  item,
  allOps,
  parentGroup = null,
  isParent = false,
  changeReason,
  allowUpdateExisting,
}) {
  const existing = isParent
    ? findParentByName(allOps, item.menuGroup)
    : findByPath(allOps, item.path);

  if (existing) {
    if (!allowUpdateExisting && existing.isActive) {
      return { status: "skipped", operationMasterNo: existing.operationMasterNo };
    }
    await operationsApi.saveOperation({
      operationMasterNo: existing.operationMasterNo,
      menuGroup: item.menuGroup,
      path: isParent ? null : item.path,
      order: item.order,
      parentGroup: isParent ? null : parentGroup,
      notForMenu: false,
      forMobile: item.forMobile ?? false,
      isParent,
      isActive: true,
      changeReason,
    });
    return { status: "updated", operationMasterNo: existing.operationMasterNo };
  }

  const newId = await saveOperationPayload({
    operationMasterNo: 0,
    menuGroup: item.menuGroup,
    path: isParent ? null : item.path,
    order: item.order,
    parentGroup: isParent ? null : parentGroup,
    notForMenu: false,
    forMobile: item.forMobile ?? false,
    isParent,
    isActive: true,
    changeReason,
  });
  return { status: "created", operationMasterNo: newId };
}

async function loadAllOperations() {
  const allData = await operationsApi.getOperations();
  return Array.isArray(allData) ? allData : (allData.items ?? []);
}

/**
 * Add only missing menu rows — existing active entries are left unchanged.
 */
export async function seedMissingMenuItems() {
  let allOps = await loadAllOperations();
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const item of DEFAULT_MENU_SEED.topLevel) {
    const result = await upsertMenuItem({
      item,
      allOps,
      changeReason: "Default menu seed (add missing)",
      allowUpdateExisting: false,
    });
    if (result.status === "created") created++;
    else if (result.status === "updated") updated++;
    else skipped++;
  }

  let adminParent = findParentByName(allOps, DEFAULT_MENU_SEED.adminGroup.menuGroup);
  if (!adminParent) {
    const parentResult = await upsertMenuItem({
      item: DEFAULT_MENU_SEED.adminGroup,
      allOps,
      isParent: true,
      changeReason: "Default menu seed (add missing)",
      allowUpdateExisting: false,
    });
    if (parentResult.status === "created") created++;
    else if (parentResult.status === "updated") updated++;
    else skipped++;
    allOps = await loadAllOperations();
    adminParent = findParentByName(allOps, DEFAULT_MENU_SEED.adminGroup.menuGroup);
  }

  const parentId = adminParent?.operationMasterNo;
  for (const child of DEFAULT_MENU_SEED.adminGroup.children) {
    const result = await upsertMenuItem({
      item: child,
      allOps,
      parentGroup: parentId ?? null,
      changeReason: "Default menu seed (add missing)",
      allowUpdateExisting: false,
    });
    if (result.status === "created") created++;
    else if (result.status === "updated") updated++;
    else skipped++;
  }

  return { created, skipped, updated };
}

/**
 * Reset menu to the default seed: deactivate all current rows, then upsert the catalog.
 */
export async function resetAndSeedMenuItems() {
  let allOps = await loadAllOperations();
  let deactivated = 0;

  for (const op of allOps.filter((o) => o.isActive)) {
    await operationsApi.saveOperation({
      operationMasterNo: op.operationMasterNo,
      menuGroup: op.menuGroup,
      path: op.path || null,
      order: op.order ?? 0,
      parentGroup: op.parentGroup ?? null,
      notForMenu: op.notForMenu ?? false,
      forMobile: op.forMobile ?? false,
      isParent: op.isParent ?? false,
      isActive: false,
      changeReason: "Reset default menu seed",
    });
    deactivated++;
  }

  allOps = await loadAllOperations();

  let created = 0;
  let updated = 0;

  for (const item of DEFAULT_MENU_SEED.topLevel) {
    const result = await upsertMenuItem({
      item,
      allOps,
      changeReason: "Reset default menu seed",
      allowUpdateExisting: true,
    });
    if (result.status === "created") created++;
    else updated++;
  }

  const parentResult = await upsertMenuItem({
    item: DEFAULT_MENU_SEED.adminGroup,
    allOps,
    isParent: true,
    changeReason: "Reset default menu seed",
    allowUpdateExisting: true,
  });
  if (parentResult.status === "created") created++;
  else updated++;

  const parentId = parentResult.operationMasterNo
    ?? findParentByName(allOps, DEFAULT_MENU_SEED.adminGroup.menuGroup)?.operationMasterNo;

  for (const child of DEFAULT_MENU_SEED.adminGroup.children) {
    const result = await upsertMenuItem({
      item: child,
      allOps,
      parentGroup: parentId ?? null,
      changeReason: "Reset default menu seed",
      allowUpdateExisting: true,
    });
    if (result.status === "created") created++;
    else updated++;
  }

  return { deactivated, created, updated };
}
