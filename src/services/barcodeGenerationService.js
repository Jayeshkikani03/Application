function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function padNumber(value, length) {
  return String(value).padStart(length, "0");
}

function getBarcodeProjects(state) {
  return state.projects?.length ? state.projects : [];
}

function resolveActiveProjectId(state) {
  const projects = getBarcodeProjects(state);
  const preferredId = state?.activeProjectId;
  if (preferredId && projects.some((project) => project.id === preferredId)) {
    return preferredId;
  }
  return projects[0]?.id ?? "";
}

function projectHasSchedule(project) {
  if (!project) return false;
  return (project.schedule?.periods?.length ?? 0) > 0;
}

function getPeriodDisplayNumber(period) {
  const labelMatch = String(period?.label ?? "").match(/(\d+)/);
  if (labelMatch) return Number(labelMatch[1]);
  const codeMatch = String(period?.code ?? "").match(/(\d+)/);
  if (codeMatch) return Number(codeMatch[1]);
  return null;
}

function formatPeriodDisplayLabel(period) {
  const num = getPeriodDisplayNumber(period);
  return num != null ? String(num) : String(period?.label ?? period?.code ?? "-");
}

function periodDataScore(period) {
  return (
    (period?.entries?.length ?? 0) * 10 +
    (period?.doseLabels?.length ?? 0) * 5 +
    (period?.doses?.length ?? 0) * 8
  );
}

function mergeBarcodePeriods(primary, secondary) {
  return {
    ...primary,
    code: primary.code ?? secondary.code,
    entries: primary.entries?.length ? primary.entries : secondary.entries ?? [],
    doseLabels: [...new Set([...(primary.doseLabels ?? []), ...(secondary.doseLabels ?? [])])],
    doses: primary.doses?.length ? primary.doses : secondary.doses ?? [],
  };
}

function dedupeBarcodePeriods(periods) {
  const byKey = new Map();

  for (const period of periods ?? []) {
    const displayNumber = getPeriodDisplayNumber(period);
    const key = displayNumber ?? period.id;

    if (!byKey.has(key)) {
      byKey.set(key, { ...period });
      continue;
    }

    const existing = byKey.get(key);
    const preferred =
      periodDataScore(period) > periodDataScore(existing)
        ? mergeBarcodePeriods(period, existing)
        : mergeBarcodePeriods(existing, period);
    byKey.set(key, preferred);
  }

  return [...byKey.values()].sort(
    (a, b) => (getPeriodDisplayNumber(a) ?? Number.MAX_SAFE_INTEGER) - (getPeriodDisplayNumber(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

function normalizeBarcodePeriodList(periods) {
  return dedupeBarcodePeriods(periods).map((period) => {
    const displayNumber = getPeriodDisplayNumber(period);
    return {
      ...period,
      label: formatPeriodDisplayLabel(period),
      code: displayNumber != null ? padNumber(displayNumber, 2) : period.code,
    };
  });
}

function getBarcodePeriods(state, projectId) {
  if (!projectId) return [];

  const projects = getBarcodeProjects(state);
  const project = projects.find((item) => item.id === projectId);
  if (!project) return [];

  if (project.schedule?.periods?.length) {
    return normalizeBarcodePeriodList(project.schedule.periods);
  }
  return [];
}

function buildTimepointsFromEntries(period) {
  return (period.entries ?? []).map((entry, index) => {
    const order = entry.order ?? index + 1;
    const label = String(entry.label ?? "").trim();
    return {
      id: `${period.id}-${entry.doseLabel}-${entry.label}-${order}`,
      label,
      displayLabel: label,
      activity: inferActivityFromTimepointLabel(label),
      activityType: inferActivityFromTimepointLabel(label),
      offset: entry.offset ?? null,
      doseLabel: entry.doseLabel,
      periodId: period.id,
      order,
      generatesPkLabel: !/imp|dose admin/i.test(label) && !/^dose\s+\d+$/i.test(label),
    };
  });
}

function inferActivityFromTimepointLabel(label) {
  const text = String(label ?? "");
  if (/pre-dose/i.test(text)) return "Pre-Dose Blood Collection";
  if (/^dose\s+\d+$/i.test(text.trim())) return "IMP Dose Administration";
  if (/imp|dose admin/i.test(text)) return "IMP Dose Administration";
  return "Post-Dose Blood Collection";
}

function getActiveDosesForPeriod(period) {
  if (period?.doses?.length) {
    return [...period.doses]
      .filter((dose) => dose.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  return (period?.doseLabels ?? []).map((label, index) => ({
    id: `${period.id}-dose-${index + 1}`,
    label,
    order: index + 1,
    isActive: true,
    timepoints: [],
  }));
}

function resolveTimepointActivity(timepoint) {
  if (timepoint.activityType === "IMP Dose Administration") return "IMP Dose Administration";
  if (timepoint.activityType === "Pre-Dose Blood Collection") return "Pre-Dose Blood Collection";
  if (timepoint.activityType === "Post-Dose Blood Collection") return "Post-Dose Blood Collection";
  if (timepoint.activity) return timepoint.activity;
  return inferActivityFromTimepointLabel(timepoint.label);
}

function isBloodCollectionTimepoint(timepoint) {
  const activity = resolveTimepointActivity(timepoint);
  return activity !== "IMP Dose Administration";
}

function buildTimepointsFromConfiguredDoses(period) {
  const activeDoses = getActiveDosesForPeriod(period);
  const result = [];

  activeDoses.forEach((dose) => {
    const sortedTimepoints = [...(dose.timepoints ?? [])]
      .filter((timepoint) => timepoint.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    sortedTimepoints.forEach((timepoint) => {
      const activity = resolveTimepointActivity(timepoint);
      const label = String(timepoint.label ?? "").trim();
      const order = timepoint.order ?? result.length + 1;
      result.push({
        id: timepoint.id ?? `${period.id}-${dose.id}-tp-${order}`,
        activityConfigTimePointNo: Number(timepoint.activityConfigTimePointNo) || 0,
        label,
        displayLabel: label,
        activity,
        activityType: timepoint.activityType ?? activity,
        offset: timepoint.offset ?? null,
        doseLabel: dose.label,
        doseId: dose.id,
        periodId: period.id,
        order,
        generatesPkLabel: activity !== "IMP Dose Administration",
      });
    });
  });

  return result;
}

function getPkTimepointsForPeriod(stateOrPeriod, maybePeriod) {
  const period = maybePeriod ?? stateOrPeriod;
  let timepoints;

  if (period?.doses?.length) {
    timepoints = buildTimepointsFromConfiguredDoses(period);
  } else if (period?.entries?.length) {
    timepoints = buildTimepointsFromEntries(period);
  } else {
    timepoints = [];
  }

  return timepoints.filter(isBloodCollectionTimepoint);
}

function filterSelectedTimepoints(period, selectedTimepointIds, { pkOnly = false } = {}) {
  return getPkTimepointsForPeriod(period).filter((timepoint) => {
    const isSelected =
      selectedTimepointIds.has(timepoint.id) || selectedTimepointIds.has(timepoint.label);
    if (!isSelected) return false;
    if (pkOnly && timepoint.generatesPkLabel === false) return false;
    return true;
  });
}

function addBarcodeProject(state, { code, name }) {
  const projectCode = String(code ?? "").trim();
  if (!projectCode) throw new Error("Enter a project code.");

  const projects = getBarcodeProjects(state);
  const duplicate = projects.some((project) => normalizeCode(project.code) === normalizeCode(projectCode));
  if (duplicate) throw new Error(`Project ${projectCode} already exists.`);

  const project = {
    id: `proj-${Date.now()}`,
    code: projectCode,
    name: String(name ?? "").trim() || `Project ${projectCode}`,
  };

  return {
    ...state,
    projects: [...(state.projects ?? []), project],
  };
}

function importProjectSchedule(state, projectId, schedule) {
  const projects = state.projects ?? [];
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Select a valid project.");
  if (!schedule?.periods?.length) throw new Error("The uploaded schedule does not contain any periods.");

  return {
    ...state,
    projects: projects.map((item) =>
      item.id === projectId
        ? { ...item, schedule }
        : item
    ),
  };
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return number;
}

function requireNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be 0 or a positive whole number.`);
  }
  return number;
}

function randomDigits(length) {
  const max = 10 ** length;
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return padNumber(values[0] % max, length);
  }
  return padNumber(Math.floor(Math.random() * max), length);
}

function cleanProjectCode(code) {
  return String(code ?? "").replace(/-/g, "");
}

function cleanParticipantCode(code) {
  return String(code ?? "").replace(/-/g, "");
}

function parseSiteParticipantStart(value) {
  const raw = String(value ?? "").trim();
  const dashed = raw.match(/^(\d{3})-(\d{2})$/);
  if (dashed) {
    const participantStart = Number(dashed[2]);
    if (participantStart <= 0) {
      throw new Error("Participant number must start from 01 or higher.");
    }
    return {
      site: dashed[1],
      participantStart,
      participantWidth: 2,
    };
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 5) {
    throw new Error("Site and participant must be exactly 5 digits, for example 10101 or 101-01.");
  }

  const site = digits.slice(0, 3);
  const participantPart = digits.slice(3);
  const participantStart = Number(participantPart);
  if (participantStart <= 0) {
    throw new Error("Participant number must start from 01 or higher.");
  }

  return {
    site,
    participantStart,
    participantWidth: 2,
  };
}

function sanitizeSiteParticipantStart(value) {
  const raw = String(value ?? "");
  const digits = raw.replace(/\D/g, "").slice(0, 5);
  const wantsDash = raw.includes("-");

  if (wantsDash) {
    if (digits.length <= 3) {
      return digits.length === 3 && raw.endsWith("-") ? `${digits}-` : digits;
    }
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return digits;
}

function formatParticipantCode(site, participantNumber, participantWidth, hasDash) {
  return hasDash
    ? `${site}-${padNumber(participantNumber, participantWidth)}`
    : `${site}${padNumber(participantNumber, participantWidth)}`;
}

function timepointCode(order) {
  return order >= 100 ? String(order) : padNumber(order, 2);
}

function periodLabelCode(period) {
  const match = String(period?.code ?? "").match(/\d+/);
  return match ? String(Number(match[0])) : "0";
}

/** Unpadded timepoint order for print captions (e.g. 1, 12 — not 01). */
function timepointCaptionCode(order) {
  const n = Number(order);
  return Number.isFinite(n) ? String(n) : "0";
}

/**
 * Compact print caption, e.g.
 * `14321-101-01112-1` (aliquot) or `14321-101-01112` (PK).
 */
function buildBarcodeCaption({ projectCode, subject, periodNo, timepointNo, aliquotNo }) {
  const period = String(periodNo ?? "0");
  const tp = String(timepointNo ?? "0");
  const compactBase = `${projectCode}-${subject}${period}${tp}`;
  if (aliquotNo != null && aliquotNo !== "") {
    return `${compactBase}-${aliquotNo}`;
  }
  return compactBase;
}

function buildBagBarcodeCaption({ projectCode, subject, bagNo }) {
  return `${projectCode}-${subject}-B${bagNo}`;
}

function generateBarcodeBatch(state, params) {
  const projects = getBarcodeProjects(state);
  const periods =
    params.resolvedPeriods?.length > 0
      ? params.resolvedPeriods
      : getBarcodePeriods(state, params.projectId);
  const project =
    projects.find((item) => item.id === params.projectId) ??
    (params.projectCode
      ? projects.find((item) => normalizeCode(item.code) === normalizeCode(params.projectCode))
      : null);
  const selectedPeriodIds = params.periodIds ?? [params.periodId].filter(Boolean);
  const selectedPeriods = periods.filter((item) => selectedPeriodIds.includes(item.id));
  const selectedTimepointIds = new Set(params.timepointIds ?? params.timepointLabels ?? []);
  const shouldGeneratePk = Boolean(params.generatePk);

  if (!project) {
    throw new Error("Select a valid project.");
  }
  if (selectedPeriods.length === 0) {
    throw new Error("Select at least one period.");
  }

  const { site, participantStart, participantWidth } = parseSiteParticipantStart(
    params.siteParticipantStart ?? params.subjectStart
  );
  const hasDash = String(params.siteParticipantStart ?? params.subjectStart ?? "").includes("-");
  const totalSubjects = requirePositiveInteger(params.totalSubjects, "Total Number of Participants");
  const lotCount = requireNonNegativeInteger(params.lotCount, "Number of Lots");
  const bagCount = requireNonNegativeInteger(params.bagCount, "Number of Bags to Generate");
  const lastParticipantNumber = participantStart + totalSubjects - 1;
  if (lastParticipantNumber >= 10 ** Math.max(participantWidth, 1)) {
    throw new Error(`Participant numbers cannot exceed ${"9".repeat(participantWidth)} for the selected site range.`);
  }

  const selectedTimepoints = [];
  if (shouldGeneratePk) {
    const seenIds = new Set();
    selectedPeriods.forEach((period) => {
      filterSelectedTimepoints(period, selectedTimepointIds, { pkOnly: true }).forEach((timepoint) => {
        if (!seenIds.has(timepoint.id)) {
          seenIds.add(timepoint.id);
          selectedTimepoints.push(timepoint);
        }
      });
    });
    if (selectedTimepoints.length === 0) {
      throw new Error("No selected time points are configured for the selected periods.");
    }
  }

  // Only barcodes from Generate/Import (have generatedRunId) affect uniqueness/sequences.
  // Stored DB codes (existingBarcodeCodes) are included so one-by-one Generate continues PK/AL
  // after a refresh, when LabContext memory is empty.
  const storedBarcodeEntries = (params.existingBarcodeCodes ?? [])
    .map((code) => String(code ?? "").trim())
    .filter(Boolean)
    .map((code) => ({ code }));
  const sequenceSourceBarcodes = [
    ...state.barcodes.filter((barcode) => barcode.generatedRunId),
    ...storedBarcodeEntries,
  ];
  const existingCodes = new Set(sequenceSourceBarcodes.map((barcode) => normalizeCode(barcode.code)));
  const generatedCodes = new Set();
  const runId = params.runId ?? `run-${Date.now()}`;
  const generatedAt = new Date().toISOString();

  const subjects = [];
  const visits = [];
  const activities = [];
  const barcodes = [];
  const aliquots = [];
  const previewSubjects = [];
  const previewPk = [];
  const previewAliquots = [];
  const previewBags = [];

  function reserveCode(code) {
    const normalized = normalizeCode(code);
    if (existingCodes.has(normalized) || generatedCodes.has(normalized)) {
      throw new Error(`Duplicate barcode value detected: ${code}`);
    }
    generatedCodes.add(normalized);
  }

  function makeRandomBarcode(prefix) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = `${prefix}${randomDigits(5)}`;
      const normalized = normalizeCode(code);
      if (!existingCodes.has(normalized) && !generatedCodes.has(normalized)) {
        reserveCode(code);
        return code;
      }
    }
    throw new Error(`Unable to generate a unique ${prefix} barcode. Try generating a smaller batch.`);
  }

  function getNextSequence(prefix) {
    const matcher = new RegExp(`^${prefix}(\\d{6})$`, "i");
    return sequenceSourceBarcodes.reduce((max, barcode) => {
      const match = String(barcode.code ?? "").match(matcher);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  }

  function makeSequentialBarcode(prefix, nextValue) {
    for (let sequence = nextValue; sequence <= 999999; sequence += 1) {
      const code = `${prefix}${padNumber(sequence, 6)}`;
      const normalized = normalizeCode(code);
      if (!existingCodes.has(normalized) && !generatedCodes.has(normalized)) {
        reserveCode(code);
        return { code, nextValue: sequence + 1 };
      }
    }
    throw new Error(`Unable to generate a unique ${prefix} barcode. Sequence limit reached.`);
  }

  let nextPkSequence = getNextSequence("PK");
  let nextAliquotSequence = getNextSequence("AL");

  for (let index = 0; index < totalSubjects; index += 1) {
    const participantNumberValue = participantStart + index;
    const participantLabel = formatParticipantCode(site, participantNumberValue, participantWidth, hasDash);
    const subjectBarcode = participantLabel;
    const subjectId = `gen-sub-${subjectBarcode}`;
    const labelProjectCode = cleanProjectCode(project.code);
    const labelSubjectCode = hasDash
      ? `${site}-${padNumber(participantNumberValue, participantWidth)}`
      : `${site}${padNumber(participantNumberValue, participantWidth)}`;

    reserveCode(subjectBarcode);

    subjects.push({
      id: subjectId,
      subjectNumber: subjectBarcode,
      barcode: subjectBarcode,
      linkedGeneratedBarcode: subjectBarcode,
      projectId: project.id,
      projectCode: project.code,
      cohort: project.name,
      status: "Ready",
      generated: true,
      barcodeLinked: true,
    });
    barcodes.push({
      code: subjectBarcode,
      type: "subject",
      subjectId,
      label: `${project.code}-${participantLabel}`,
      generatedRunId: runId,
    });
    previewSubjects.push({
      barcode: subjectBarcode,
      label: "Participant",
      meta: `${project.code}-${participantLabel}`,
      caption: `${project.code}-${participantLabel}`,
      participantLabel,
    });

    // One bag per Period × Lot (batch) so Bag Preparation can match vPeriod + nBatchNo.
    // Falls back to free-form bagCount when lots are not configured.
    const batchCountForBags = lotCount > 0 ? lotCount : 0;
    if (batchCountForBags > 0 && selectedPeriods.length > 0) {
      let bagSeq = 0;
      selectedPeriods.forEach((selectedPeriod) => {
        for (let batchNo = 1; batchNo <= batchCountForBags; batchNo += 1) {
          bagSeq += 1;
          const periodLabel = String(selectedPeriod.label ?? selectedPeriod.code ?? "").trim() || String(batchNo);
          const bagLabel = `${labelProjectCode}-${labelSubjectCode}-B${bagSeq}`;
          const bagBarcode = makeRandomBarcode("BG");
          const bagCaption = buildBagBarcodeCaption({
            projectCode: labelProjectCode,
            subject: labelSubjectCode,
            bagNo: bagSeq,
          });
          previewBags.push({
            barcode: bagBarcode,
            label: "Bag",
            meta: bagLabel,
            caption: bagCaption,
            participantLabel,
            period: periodLabel,
            lotNo: batchNo,
          });
          barcodes.push({
            code: bagBarcode,
            type: "bag",
            subjectId,
            label: bagCaption,
            generatedRunId: runId,
          });
        }
      });
    } else {
      for (let bagIndex = 0; bagIndex < bagCount; bagIndex += 1) {
        const bagLabel = `${labelProjectCode}-${labelSubjectCode}-B${bagIndex + 1}`;
        const bagBarcode = makeRandomBarcode("BG");
        const bagCaption = buildBagBarcodeCaption({
          projectCode: labelProjectCode,
          subject: labelSubjectCode,
          bagNo: bagIndex + 1,
        });
        previewBags.push({
          barcode: bagBarcode,
          label: "Bag",
          meta: bagLabel,
          caption: bagCaption,
          participantLabel,
          period: selectedPeriods[0] ? String(selectedPeriods[0].label ?? selectedPeriods[0].code ?? "").trim() || null : null,
          lotNo: bagIndex + 1,
        });
        barcodes.push({
          code: bagBarcode,
          type: "bag",
          subjectId,
          label: bagCaption,
          generatedRunId: runId,
        });
      }
    }

    selectedPeriods.forEach((selectedPeriod) => {
      const visitId = `gen-vis-${labelSubjectCode}-${selectedPeriod.code}`;
      const doseActivityId = `gen-act-${labelSubjectCode}-${selectedPeriod.code}-dose`;

      visits.push({
        id: visitId,
        subjectId,
        periodCode: selectedPeriod.code,
        label: selectedPeriod.label,
        doseLabel: getActiveDosesForPeriod(selectedPeriod).map((dose) => dose.label).join(", "),
        status: "Ready",
        plannedDoseTime: null,
        actualDoseTime: null,
        generated: true,
      });
      getActiveDosesForPeriod(selectedPeriod).forEach((dose, doseIndex) => {
        const doseLabel = dose.label;
        const doseActivityId = `gen-act-${labelSubjectCode}-${selectedPeriod.code}-dose-${doseIndex + 1}`;
        activities.push({
          id: doseActivityId,
          subjectId,
          visitId,
          subjectNumber: subjectBarcode,
          visitLabel: selectedPeriod.label,
          dose: doseLabel,
          timepoint: doseLabel,
          activity: "IMP Dose Administration",
          executionMethod: "manual",
          scheduledTime: null,
          windowStart: null,
          windowEnd: null,
          actualTime: null,
          status: doseIndex === 0 ? "Ready" : "Upcoming",
          deviation: false,
          deviationReason: null,
          remarks: null,
          barcode: null,
          sampleId: null,
          pkOffsetMinutes: null,
        });
      });

      if (shouldGeneratePk) {
        const selectedTimepoints = filterSelectedTimepoints(selectedPeriod, selectedTimepointIds, {
          pkOnly: true,
        });

        selectedTimepoints.forEach((timepoint, pkIndex) => {
          const expectedAliquotBarcodes = [];
          const timepointKey = timepoint.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
          const activityId = `gen-act-${labelSubjectCode}-${selectedPeriod.code}-${timepointKey}`;
          const sampleId = `gen-smp-${labelSubjectCode}-${selectedPeriod.code}-${timepointKey}`;
          const aliquotsToGenerate = lotCount;
          const periodNo = periodLabelCode(selectedPeriod);
          // Sequential among PK timepoints only (skip IMP dose admin DisplayOrder gaps).
          const tpSeq = pkIndex + 1;
          const tpNo = timepointCaptionCode(tpSeq);
          const pkLabel = `${labelProjectCode}-${labelSubjectCode}${periodLabelCode(selectedPeriod)}${timepointCode(tpSeq)}`;
          const pkCaption = buildBarcodeCaption({
            projectCode: labelProjectCode,
            subject: labelSubjectCode,
            periodNo,
            timepointNo: tpNo,
          });
          const nextPk = makeSequentialBarcode("PK", nextPkSequence);
          const pkBarcode = nextPk.code;
          const displayTimepoint = timepoint.label;
          const activityConfigTimePointNo = Number(timepoint.activityConfigTimePointNo) || 0;
          nextPkSequence = nextPk.nextValue;

          for (let aliquotIndex = 0; aliquotIndex < aliquotsToGenerate; aliquotIndex += 1) {
            const aliquotNo = aliquotIndex + 1;
            const aliquotLabel = `${pkLabel}-${aliquotNo}`;
            const aliquotCaption = buildBarcodeCaption({
              projectCode: labelProjectCode,
              subject: labelSubjectCode,
              periodNo,
              timepointNo: tpNo,
              aliquotNo,
            });
            const nextAliquot = makeSequentialBarcode("AL", nextAliquotSequence);
            const aliquotBarcode = nextAliquot.code;
            const aliquotId = `gen-alq-${labelSubjectCode}-${selectedPeriod.code}-${timepointKey}-${padNumber(aliquotNo, 2)}`;
            nextAliquotSequence = nextAliquot.nextValue;
            expectedAliquotBarcodes.push(aliquotBarcode);
            aliquots.push({
              id: aliquotId,
              barcode: aliquotBarcode,
              parentSampleId: sampleId,
              parentBarcode: pkBarcode,
              subjectId,
              subjectNumber: subjectBarcode,
              createdAt: null,
              storageLocation: null,
              label: aliquotLabel,
              generatedRunId: runId,
            });
            previewAliquots.push({
              barcode: aliquotBarcode,
              label: displayTimepoint,
              meta: aliquotLabel,
              caption: aliquotCaption,
              participantLabel,
              activityConfigTimePointNo: activityConfigTimePointNo || undefined,
              lotNo: aliquotNo,
            });
            barcodes.push({
              code: aliquotBarcode,
              type: "aliquot",
              subjectId,
              aliquotId,
              label: aliquotCaption,
              generatedRunId: runId,
            });
          }

          activities.push({
            id: activityId,
            subjectId,
            visitId,
            subjectNumber: subjectBarcode,
            visitLabel: selectedPeriod.label,
            dose: timepoint.doseLabel,
            periodCode: selectedPeriod.code,
            timepoint: timepoint.label,
            activity: timepoint.activity,
            executionMethod: "pkBarcode",
            scheduledTime: null,
            windowStart: null,
            windowEnd: null,
            actualTime: null,
            status: timepoint.activity === "Pre-Dose Blood Collection" ? "Ready" : "Upcoming",
            deviation: false,
            deviationReason: null,
            remarks: null,
            barcode: pkBarcode,
            sampleId,
            pkOffsetMinutes: timepoint.offset,
            expectedAliquots: aliquotsToGenerate,
            expectedAliquotBarcodes,
          });
          barcodes.push({
            code: pkBarcode,
            type: "pk",
            activityId,
            label: pkCaption,
            generatedRunId: runId,
          });
          previewPk.push({
            barcode: pkBarcode,
            label: displayTimepoint,
            meta: pkLabel,
            caption: pkCaption,
            participantLabel,
            activityConfigTimePointNo: activityConfigTimePointNo || undefined,
          });
        });
      }
    });
  }

  const run = {
    id: runId,
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    labelType: params.labelType ?? "PK Label",
    periodId: selectedPeriods[0].id,
    periodIds: selectedPeriods.map((p) => p.id),
    periodCode: selectedPeriods.map((p) => p.code).join(", "),
    periodLabel: selectedPeriods.map((p) => p.label).join(", "),
    doseLabel: [...new Set(selectedPeriods.flatMap((p) => getActiveDosesForPeriod(p).map((dose) => dose.label)))].join(", "),
    timepointIds: [...selectedTimepointIds],
    timepointLabels: [
      ...new Set(
        selectedPeriods.flatMap((p) =>
          filterSelectedTimepoints(p, selectedTimepointIds).map((timepoint) => timepoint.displayLabel)
        )
      ),
    ],
    siteParticipantStart: params.siteParticipantStart ?? params.subjectStart,
    totalSubjects,
    lotCount,
    bagCount: previewBags.length,
    generatePk: shouldGeneratePk,
    generatedAt,
    subjects: previewSubjects,
    pk: previewPk,
    aliquots: previewAliquots,
    bags: previewBags,
  };

  return {
    ...state,
    projects,
    subjects: [...state.subjects, ...subjects],
    visits: [...state.visits, ...visits],
    activities: [...state.activities, ...activities],
    aliquots: [...state.aliquots, ...aliquots],
    barcodes: [...state.barcodes, ...barcodes],
    generatedBarcodeRuns: [run, ...(state.generatedBarcodeRuns ?? [])],
  };
}

function participantLabelFromSubjectMeta(meta) {
  const parts = String(meta ?? "").split("-");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  }
  return String(meta ?? "");
}

function participantCodeFromLabel(participantLabel) {
  return String(participantLabel ?? "").replace(/-/g, "");
}

function participantCodeFromItemMeta(meta) {
  const match = String(meta ?? "").match(/^[^-]+-(\d+)/);
  return match?.[1] ?? "";
}

function groupBarcodesByParticipant(run) {
  const groups = (run.subjects ?? []).map((subject) => ({
    participantLabel: subject.participantLabel ?? participantLabelFromSubjectMeta(subject.meta),
    participantCode: participantCodeFromLabel(subject.participantLabel ?? participantLabelFromSubjectMeta(subject.meta)),
    subject,
    pk: [],
    aliquots: [],
    bags: [],
  }));

  const findGroup = (participantLabel, participantCode) => {
    if (participantLabel) {
      const byLabel = groups.find((group) => group.participantLabel === participantLabel);
      if (byLabel) return byLabel;
    }
    if (participantCode) {
      return groups.find((group) => group.participantCode === participantCode);
    }
    return null;
  };

  const assignItems = (items, key) => {
    (items ?? []).forEach((item) => {
      const group = findGroup(item.participantLabel, participantCodeFromLabel(item.participantLabel) || participantCodeFromItemMeta(item.meta));
      if (group) group[key].push(item);
    });
  };

  assignItems(run.pk, "pk");
  assignItems(run.aliquots, "aliquots");
  assignItems(run.bags, "bags");

  return groups;
}

function flattenImportedBarcodeSource(source) {
  // Root subjects array from external mock: [{ barcode, pk, bags }, ...]
  const normalized = Array.isArray(source) ? { subjects: source } : source;
  if (!normalized) {
    return normalized;
  }

  // Already flat (legacy): subjects + top-level pk/aliquots/bags
  const first = normalized?.subjects?.[0];
  const nested = first && (Array.isArray(first.pk) || Array.isArray(first.bags));
  if (!nested) {
    return normalized;
  }

  const subjects = [];
  const pk = [];
  const aliquots = [];
  const bags = [];

  for (const subject of normalized.subjects ?? []) {
    const participantLabel = String(subject.barcode ?? "").trim();
    if (!participantLabel) continue;

    subjects.push({
      barcode: participantLabel,
      label: subject.label ?? "Participant",
      caption: subject.caption,
      participantLabel,
    });

    for (const pkItem of subject.pk ?? []) {
      const pkBarcode = String(pkItem.barcode ?? "").trim();
      if (!pkBarcode) continue;
      pk.push({
        barcode: pkBarcode,
        label: pkItem.label,
        caption: pkItem.caption,
        participantLabel,
        activityConfigTimePointNo: pkItem.activityConfigTimePointNo,
      });
      for (const aliquot of pkItem.aliquots ?? []) {
        const aliquotBarcode = String(aliquot.barcode ?? "").trim();
        if (!aliquotBarcode) continue;
        aliquots.push({
          barcode: aliquotBarcode,
          label: aliquot.label,
          caption: aliquot.caption,
          participantLabel,
          activityConfigTimePointNo: pkItem.activityConfigTimePointNo,
          lotNo: Number(aliquot.lotNo ?? aliquot.LotNo) || null,
        });
      }
    }

    for (const bag of subject.bags ?? []) {
      const bagBarcode = String(bag.barcode ?? "").trim();
      if (!bagBarcode) continue;
      bags.push({
        barcode: bagBarcode,
        label: bag.label ?? "Bag",
        caption: bag.caption,
        participantLabel,
        period: bag.period ?? bag.Period ?? null,
        lotNo: Number(bag.lotNo ?? bag.LotNo) || null,
      });
    }
  }

  return {
    ...normalized,
    subjects,
    pk,
    aliquots,
    bags,
    totalSubjects: subjects.length,
    bagCount: bags.length,
    generatePk: normalized.generatePk ?? pk.length > 0,
    lotCount: normalized.lotCount > 0 ? normalized.lotCount : inferLotCountFromNested(normalized),
    siteParticipantStart: normalized.siteParticipantStart || subjects[0]?.barcode || "",
  };
}

function inferLotCountFromNested(source) {
  for (const subject of source?.subjects ?? []) {
    for (const pkItem of subject.pk ?? []) {
      const count = Array.isArray(pkItem.aliquots) ? pkItem.aliquots.length : 0;
      if (count > 0) return count;
    }
  }
  return 0;
}

function mergeImportedBarcodeRun(state, importPayload, options = {}) {
  // Prefer flattened run from ApplicationAPI; fall back to nested payload or raw array.
  const raw = importPayload?.run ?? importPayload?.nested ?? importPayload;
  const source = flattenImportedBarcodeSource(raw);
  if (!source || !Array.isArray(source.subjects) || source.subjects.length === 0) {
    throw new Error("Imported barcode payload is empty.");
  }

  const projects = getBarcodeProjects(state);
  const preferredProjectId = String(options.projectId ?? "").trim();
  const preferredProject = preferredProjectId
    ? projects.find((project) => project.id === preferredProjectId)
    : null;

  const projectCode = String(
    preferredProject?.code ?? source.projectCode ?? options.projectCode ?? ""
  ).trim();
  const matchedProject =
    preferredProject ??
    projects.find((project) => normalizeCode(project.code) === normalizeCode(projectCode)) ??
    projects.find((project) => normalizeCode(project.id) === normalizeCode(source.projectId)) ??
    null;

  const runId = String(source.id ?? `run-import-${Date.now()}`);
  const existingRun = (state.generatedBarcodeRuns ?? []).find((run) => run.id === runId);
  if (existingRun) {
    const rebound = {
      ...existingRun,
      projectId: matchedProject?.id ?? existingRun.projectId,
      projectCode: matchedProject?.code ?? existingRun.projectCode,
      projectName: matchedProject?.name ?? existingRun.projectName,
    };
    return {
      ...state,
      generatedBarcodeRuns: [rebound, ...(state.generatedBarcodeRuns ?? []).filter((run) => run.id !== runId)],
    };
  }

  const projectId =
    matchedProject?.id ??
    (preferredProjectId || source.projectId || projectCode || "");
  const run = {
    id: runId,
    projectId,
    projectCode: matchedProject?.code ?? projectCode,
    projectName: matchedProject?.name ?? source.projectName ?? `Project ${projectCode}`,
    labelType: source.labelType ?? "PK Label",
    periodId: source.periodId ?? "period-1",
    periodIds: source.periodIds ?? ["period-1"],
    periodCode: source.periodCode ?? "",
    periodLabel: source.periodLabel ?? "",
    doseLabel: source.doseLabel ?? "",
    timepointIds: source.timepointIds ?? [],
    timepointLabels: source.timepointLabels ?? [],
    siteParticipantStart: source.siteParticipantStart ?? "",
    totalSubjects: source.totalSubjects ?? source.subjects.length,
    lotCount: source.lotCount ?? 0,
    bagCount: source.bagCount ?? (source.bags?.length ?? 0),
    generatePk: source.generatePk !== false,
    generatedAt: source.generatedAt ?? new Date().toISOString(),
    subjects: source.subjects ?? [],
    pk: source.pk ?? [],
    aliquots: source.aliquots ?? [],
    bags: source.bags ?? [],
  };

  const barcodes = [];
  for (const item of run.subjects) {
    barcodes.push({
      code: item.barcode,
      type: "subject",
      label: item.caption ?? item.label ?? "Participant",
      generatedRunId: runId,
    });
  }
  for (const item of run.pk) {
    barcodes.push({
      code: item.barcode,
      type: "pk",
      label: item.caption ?? item.label,
      generatedRunId: runId,
    });
  }
  for (const item of run.aliquots) {
    barcodes.push({
      code: item.barcode,
      type: "aliquot",
      label: item.caption ?? item.label,
      generatedRunId: runId,
    });
  }
  for (const item of run.bags ?? []) {
    barcodes.push({
      code: item.barcode,
      type: "bag",
      label: item.caption ?? item.label ?? "Bag",
      generatedRunId: runId,
    });
  }

  return {
    ...state,
    barcodes: [...state.barcodes, ...barcodes],
    generatedBarcodeRuns: [run, ...(state.generatedBarcodeRuns ?? [])],
  };
}

function collectBarcodeCodesFromRuns(runs) {
  const codes = [];
  for (const run of runs ?? []) {
    for (const list of [run.subjects, run.pk, run.aliquots, run.bags]) {
      for (const item of list ?? []) {
        const code = String(item?.barcode ?? "").trim();
        if (code) codes.push(code);
      }
    }
  }
  return codes;
}

export {
  addBarcodeProject,
  collectBarcodeCodesFromRuns,
  generateBarcodeBatch,
  getActiveDosesForPeriod,
  getBarcodePeriods,
  getBarcodeProjects,
  getPkTimepointsForPeriod,
  groupBarcodesByParticipant,
  importProjectSchedule,
  mergeImportedBarcodeRun,
  projectHasSchedule,
  resolveActiveProjectId,
  sanitizeSiteParticipantStart,
};
