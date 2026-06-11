let selectedMarker = null;
let map = null;
let activePollTimer = null;

const selectedLocationText = document.getElementById("selected-location");
const latInput = document.getElementById("lat");
const lonInput = document.getElementById("lon");
const resultsDiv = document.getElementById("results");
const runButton = document.getElementById("run-button");
const mapBox = document.getElementById("map");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingMessage = document.getElementById("loading-message");
const loadingProgress = document.getElementById("loading-progress");

const STAGE_LABELS = {
    PENDING: "Waiting for the analysis worker...",
    FETCHING_IMAGE: "Fetching satellite imagery...",
    RUNNING_YOLO: "Running solar panel segmentation...",
    BUFFER_VERIFICATION: "Applying buffer verification...",
    IMAGE_ENHANCEMENT: "Enhancing image for fallback inference...",
    RUNNING_SAHI: "Running SAHI fallback...",
    GENERATING_OUTPUT: "Generating overlays and preparing report...",
    COMPLETED: "Preparing report...",
    FAILED: "Analysis failed."
};

mapBox.style.minHeight = "380px";
mapBox.style.display = "block";
initMap();
wireButtonRipple();

function initMap() {
    if (!window.L) {
        showMapFallback("Map library could not load. Check your internet connection and refresh.");
        return;
    }

    try {
        map = L.map("map", {
            zoomControl: true,
            attributionControl: true,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 0.85,
            worldCopyJump: false
        }).setView([20.5937, 78.9629], 5);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            noWrap: true,
            bounds: [[-85, -180], [85, 180]],
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

        map.on("click", event => {
            const { lat, lng } = normalizeLatLng(event.latlng.lat, event.latlng.lng);
            setLocation(lat, lng);
            showStatusMessage("Location selected. Ready to run analysis.");
        });

        requestAnimationFrame(() => map.invalidateSize());
        setTimeout(() => map.invalidateSize(), 300);
        setTimeout(() => map.invalidateSize(), 900);
    } catch (error) {
        console.error(error);
        showMapFallback("Map could not initialize. Refresh the page or check browser console details.");
    }
}

function showMapFallback(message) {
    mapBox.classList.add("map-box-ready");
    mapBox.innerHTML = `<div class="map-fallback">${escapeHtml(message)}</div>`;
}

function setLocation(lat, lon) {
    const normalized = normalizeLatLng(lat, lon);

    latInput.value = normalized.lat.toFixed(6);
    lonInput.value = normalized.lng.toFixed(6);
    selectedLocationText.textContent = `${normalized.lat.toFixed(6)}, ${normalized.lng.toFixed(6)}`;
    selectedLocationText.closest(".map-footer")?.classList.add("updated");
    window.setTimeout(() => selectedLocationText.closest(".map-footer")?.classList.remove("updated"), 650);

    if (!map) {
        return;
    }

    if (selectedMarker) {
        selectedMarker.setLatLng([normalized.lat, normalized.lng]);
    } else {
        selectedMarker = L.marker([normalized.lat, normalized.lng], { draggable: true }).addTo(map);
        selectedMarker.on("dragend", event => {
            const position = event.target.getLatLng();
            const normalizedPosition = normalizeLatLng(position.lat, position.lng);
            setLocation(normalizedPosition.lat, normalizedPosition.lng);
        });
    }

    map.panTo([normalized.lat, normalized.lng], { animate: true });
}

function resetSelection() {
    stopPolling();
    latInput.value = "";
    lonInput.value = "";
    selectedLocationText.textContent = "Not set";
    runButton.disabled = false;
    hideLoading();

    if (map && selectedMarker) {
        map.removeLayer(selectedMarker);
        selectedMarker = null;
    }

    resultsDiv.innerHTML = "";
}

function showStatusMessage(message) {
    resultsDiv.innerHTML = `
        <div class="result-card status-card">
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

async function runAnalysis() {
    const latNumber = Number.parseFloat(latInput.value.trim());
    const lonNumber = Number.parseFloat(lonInput.value.trim());

    if (!Number.isFinite(latNumber) || !Number.isFinite(lonNumber)) {
        showError("Please enter both latitude and longitude or click a point on the map.");
        return;
    }

    if (!isValidLatLng(latNumber, lonNumber)) {
        showError("Coordinates are out of range. Latitude must be -90 to 90 and longitude must be -180 to 180.");
        return;
    }

    stopPolling();
    runButton.disabled = true;
    showLoading("Starting analysis...", 4);
    renderProgress({ status: "PENDING", progress: 0, message: "Submitting analysis job..." });

    try {
        const response = await fetch("/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latNumber, lon: lonNumber })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(parseApiError(errorText) || "Server error while starting analysis.");
        }

        const data = await response.json();
        pollStatus(data.job_id, latNumber, lonNumber);
    } catch (error) {
        console.error(error);
        runButton.disabled = false;
        hideLoading();
        showError(formatAnalysisError(error));
    }
}

function pollStatus(jobId, lat, lon) {
    const tick = async () => {
        try {
            const response = await fetch(`/status/${encodeURIComponent(jobId)}`, { cache: "no-store" });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(parseApiError(errorText) || "Could not read analysis status.");
            }

            const status = await response.json();
            renderProgress(status);
            showLoading(status.message || STAGE_LABELS[status.status] || "Running analysis...", status.progress || 0);

            if (status.status === "COMPLETED") {
                stopPolling();
                await loadResult(jobId, lat, lon);
                return;
            }

            if (status.status === "FAILED") {
                stopPolling();
                runButton.disabled = false;
                hideLoading();
                showError(status.error || "Analysis failed. Please try another location.");
            }
        } catch (error) {
            stopPolling();
            runButton.disabled = false;
            hideLoading();
            showError(formatAnalysisError(error));
        }
    };

    tick();
    activePollTimer = window.setInterval(tick, 2000);
}

async function loadResult(jobId, lat, lon) {
    const response = await fetch(`/result/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseApiError(errorText) || "Could not load final analysis result.");
    }

    const data = await response.json();
    renderResult(data, lat, lon);
    runButton.disabled = false;
    hideLoading();
}

function stopPolling() {
    window.clearInterval(activePollTimer);
    activePollTimer = null;
}

function renderProgress(status) {
    const stage = status.status || "PENDING";
    const progress = clamp(Number(status.progress) || 0, 0, 100);
    const message = status.message || STAGE_LABELS[stage] || "Running analysis...";

    resultsDiv.innerHTML = `
        <div class="result-card progress-card">
            <div class="result-header">
                <div>
                    <h3>Analysis in progress</h3>
                    <p class="result-description">${escapeHtml(message)} Job ${escapeHtml(status.job_id || "")}</p>
                </div>
                <span class="badge ok">${escapeHtml(stage.replaceAll("_", " "))}</span>
            </div>
            <div class="live-progress">
                <div class="progress-ring large" style="--value: ${progress}%">
                    <strong>${progress}%</strong>
                </div>
                <div class="stage-list">
                    ${Object.entries(STAGE_LABELS).filter(([key]) => !["COMPLETED", "FAILED"].includes(key)).map(([key, label]) => `
                        <div class="stage-item ${key === stage ? "active" : ""} ${isStageDone(key, stage) ? "done" : ""}">
                            <span></span>
                            <p>${escapeHtml(label)}</p>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

function isStageDone(stage, currentStage) {
    const order = ["PENDING", "FETCHING_IMAGE", "RUNNING_YOLO", "BUFFER_VERIFICATION", "IMAGE_ENHANCEMENT", "RUNNING_SAHI", "GENERATING_OUTPUT", "COMPLETED"];
    return order.indexOf(stage) < order.indexOf(currentStage);
}

function showError(message) {
    resultsDiv.innerHTML = `
        <div class="result-card error-card">
            <p><strong>Error:</strong> ${escapeHtml(message)}</p>
        </div>
    `;
}

function renderResult(data, lat, lon) {
    const statusClass = data.has_solar ? "ok" : "warn";
    const confidenceNumber = Number(data.confidence);
    const confidence = formatNumber(confidenceNumber);
    const confidencePercent = clamp(Number.isFinite(confidenceNumber) ? confidenceNumber * 100 : 0, 0, 100);
    const area = formatNumber(data.area);
    const capacity = formatNumber(data.capacity_estimate_kw);
    const jsonOutput = escapeHtml(JSON.stringify(data.json_output || data, null, 2));
    const verdict = data.has_solar
        ? "Solar panels detected in the selected rooftop buffer."
        : "No verifiable solar panel was detected for this location.";
    const detectedLabel = data.has_solar ? "Detected" : "Not detected";
    const statusTone = data.has_solar ? "success" : "warning";

    resultsDiv.innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div>
                    <h3>Solar Detection Report</h3>
                    <p class="result-description">${escapeHtml(verdict)} Sample ${escapeHtml(data.sample_id || "WEB")} was analyzed at ${lat.toFixed(6)}, ${lon.toFixed(6)}.</p>
                </div>
                <span class="badge ${statusClass}">${escapeHtml(data.verification_status || data.status || "UNKNOWN")}</span>
            </div>

            <div class="result-metrics">
                <article class="metric-card summary-card">
                    <span>Solar detection status</span>
                    <strong>${escapeHtml(detectedLabel)}</strong>
                    <p>Inference mode: ${escapeHtml(data.inference_mode || "N/A")}. Buffer used: ${escapeHtml(data.buffer_used ?? "N/A")} sq ft.</p>
                </article>

                <article class="metric-card ${statusTone}">
                    <span class="metric-label">Confidence</span>
                    <div class="ring-wrap">
                        <div class="progress-ring" style="--value: ${confidencePercent}%"></div>
                        <strong class="ring-value count-up" data-count="${escapeHtml(confidenceNumber)}">${confidence}</strong>
                    </div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Estimated PV Area</span>
                    <strong class="metric-value"><span class="count-up" data-count="${escapeHtml(data.area)}">${area}</span> sqm</strong>
                    <div class="metric-track" style="--value: ${areaMetricWidth(data.area)}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Capacity Estimate</span>
                    <strong class="metric-value"><span class="count-up" data-count="${escapeHtml(data.capacity_estimate_kw)}">${capacity}</span> kW</strong>
                    <div class="metric-track" style="--value: ${areaMetricWidth(data.capacity_estimate_kw)}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Verification Status</span>
                    <strong class="metric-value">${escapeHtml(data.verification_status || data.status || "UNKNOWN")}</strong>
                    <div class="metric-track" style="--value: ${data.has_solar ? "100%" : "35%"}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Inference Mode</span>
                    <strong class="metric-value">${escapeHtml(data.inference_mode || "N/A")}</strong>
                    <div class="metric-track" style="--value: ${data.inference_mode === "PRIMARY" ? "100%" : "72%"}"><span></span></div>
                </article>
            </div>

            <div class="images">
                <div class="image-box">
                    <h4>Original image</h4>
                    <img src="${escapeHtml(data.original_image)}" alt="Original rooftop image" onerror="this.closest('.image-box').classList.add('image-error')">
                </div>
                <div class="image-box">
                    <h4>Solar detection overlay</h4>
                    <img src="${escapeHtml(data.overlay_image)}" alt="Solar detection overlay image" onerror="this.closest('.image-box').classList.add('image-error')">
                </div>
            </div>

            <div class="json-panel">
                <div class="json-header">
                    <h4>JSON output</h4>
                    <a class="result-link" href="${escapeHtml(data.json_url)}" target="_blank" rel="noopener">Open saved JSON</a>
                </div>
                <pre>${jsonOutput}</pre>
            </div>
        </div>
    `;
    animateCounters();
}

function showLoading(message = "Running analysis...", progress = 0) {
    if (!loadingOverlay || !loadingMessage) {
        return;
    }

    loadingMessage.textContent = message;
    if (loadingProgress) {
        loadingProgress.style.width = `${clamp(progress, 3, 100)}%`;
    }
    loadingOverlay.classList.add("active");
    loadingOverlay.setAttribute("aria-hidden", "false");
}

function hideLoading() {
    if (!loadingOverlay) {
        return;
    }

    loadingOverlay.classList.remove("active");
    loadingOverlay.setAttribute("aria-hidden", "true");
}

function animateCounters() {
    document.querySelectorAll(".count-up").forEach(node => {
        const target = Number.parseFloat(node.dataset.count);
        if (!Number.isFinite(target)) {
            return;
        }

        const start = performance.now();
        const duration = 900;
        const decimals = Math.abs(target) < 10 ? 2 : 1;

        const step = now => {
            const progress = clamp((now - start) / duration, 0, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            node.textContent = (target * eased).toLocaleString(undefined, {
                maximumFractionDigits: decimals
            });

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                node.textContent = formatNumber(target);
            }
        };

        requestAnimationFrame(step);
    });
}

function wireButtonRipple() {
    document.querySelectorAll("button").forEach(button => {
        button.addEventListener("pointermove", event => {
            const rect = button.getBoundingClientRect();
            button.style.setProperty("--x", `${event.clientX - rect.left}px`);
            button.style.setProperty("--y", `${event.clientY - rect.top}px`);
        });
    });
}

function normalizeLatLng(lat, lon) {
    const clampedLat = Math.max(-85, Math.min(85, Number(lat)));
    let normalizedLon = Number(lon);

    while (normalizedLon > 180) {
        normalizedLon -= 360;
    }

    while (normalizedLon < -180) {
        normalizedLon += 360;
    }

    return { lat: clampedLat, lng: normalizedLon };
}

function isValidLatLng(lat, lon) {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function parseApiError(errorText) {
    try {
        const parsed = JSON.parse(errorText);
        return parsed.detail || errorText;
    } catch {
        return errorText;
    }
}

function formatAnalysisError(error) {
    return error?.message || "Unable to complete analysis.";
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "N/A";
    }

    return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function areaMetricWidth(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return "18%";
    }

    return `${clamp(number / 2, 24, 100)}%`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
