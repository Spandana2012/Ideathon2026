let selectedMarker = null;
let map = null;

const selectedLocationText = document.getElementById("selected-location");
const latInput = document.getElementById("lat");
const lonInput = document.getElementById("lon");
const resultsDiv = document.getElementById("results");
const runButton = document.getElementById("run-button");
const mapBox = document.getElementById("map");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingMessage = document.getElementById("loading-message");
let loadingTimer = null;

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
        selectedMarker = L.marker([normalized.lat, normalized.lng], {
            draggable: true
        }).addTo(map);

        selectedMarker.on("dragend", event => {
            const position = event.target.getLatLng();
            const normalizedPosition = normalizeLatLng(position.lat, position.lng);
            setLocation(normalizedPosition.lat, normalizedPosition.lng);
        });
    }

    map.panTo([normalized.lat, normalized.lng], { animate: true });
}

function resetSelection() {
    latInput.value = "";
    lonInput.value = "";
    selectedLocationText.textContent = "Not set";

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
    const lat = latInput.value.trim();
    const lon = lonInput.value.trim();
    const latNumber = Number.parseFloat(lat);
    const lonNumber = Number.parseFloat(lon);

    if (!Number.isFinite(latNumber) || !Number.isFinite(lonNumber)) {
        showError("Please enter both latitude and longitude or click a point on the map.");
        return;
    }

    if (!isValidLatLng(latNumber, lonNumber)) {
        showError("Coordinates are out of range. Latitude must be -90 to 90 and longitude must be -180 to 180.");
        return;
    }

    runButton.disabled = true;
    showLoading();
    showStatusMessage("Fetching satellite imagery and preparing rooftop analysis...");

    try {
        const response = await fetch("/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latNumber, lon: lonNumber })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(parseApiError(errorText) || "Server error while running analysis.");
        }

        const data = await response.json();
        renderResult(data, latNumber, lonNumber);
    } catch (error) {
        console.error(error);
        showError(error.message || "Unable to complete analysis.");
    } finally {
        runButton.disabled = false;
        hideLoading();
    }
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
    const distance = formatNumber(data.distance);
    const jsonOutput = escapeHtml(JSON.stringify(data.json_output || data, null, 2));
    const verdict = data.has_solar
        ? "Solar panels detected in the selected rooftop buffer."
        : "No verifiable solar panel was detected for this location.";
    const detectedLabel = data.has_solar ? "Detected" : "Not detected";
    const bufferLabel = data.status || "UNKNOWN";
    const statusTone = data.has_solar ? "success" : "warning";

    resultsDiv.innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div>
                    <h3>Analysis result</h3>
                    <p class="result-description">${escapeHtml(verdict)} Sample ${escapeHtml(data.sample_id || "WEB")} was analyzed at ${lat.toFixed(6)}, ${lon.toFixed(6)}.</p>
                </div>
                <span class="badge ${statusClass}">${escapeHtml(data.status || "UNKNOWN")}</span>
            </div>

            <div class="result-metrics">
                <article class="metric-card summary-card">
                    <span>Result summary</span>
                    <strong>${escapeHtml(detectedLabel)}</strong>
                    <p>Sample ${escapeHtml(data.sample_id || "WEB")} processed at ${lat.toFixed(6)}, ${lon.toFixed(6)} using ${escapeHtml(data.inference_mode || "N/A")} inference.</p>
                </article>

                <article class="metric-card ${statusTone}">
                    <span class="metric-label">Solar detection status</span>
                    <strong class="metric-value">${data.has_solar ? "Yes" : "No"}</strong>
                    <div class="metric-track" style="--value: ${data.has_solar ? "100%" : "22%"}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Confidence score</span>
                    <div class="ring-wrap">
                        <div class="progress-ring" style="--value: ${confidencePercent}%"></div>
                        <strong class="ring-value">${confidence}</strong>
                    </div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Area estimation</span>
                    <strong class="metric-value">${area}</strong>
                    <div class="metric-track" style="--value: ${areaMetricWidth(data.area)}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Buffer verification</span>
                    <strong class="metric-value">${escapeHtml(bufferLabel)}</strong>
                    <div class="metric-track" style="--value: ${data.has_solar ? "100%" : "35%"}"><span></span></div>
                </article>

                <article class="metric-card">
                    <span class="metric-label">Distance from center</span>
                    <strong class="metric-value">${distance} m</strong>
                    <div class="metric-track" style="--value: ${distanceMetricWidth(data.distance)}"><span></span></div>
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
}

function showLoading() {
    const messages = [
        "Fetching satellite imagery...",
        "Running segmentation...",
        "Applying buffer verification...",
        "Generating report..."
    ];
    let index = 0;

    if (!loadingOverlay || !loadingMessage) {
        return;
    }

    loadingMessage.textContent = messages[index];
    loadingOverlay.classList.add("active");
    loadingOverlay.setAttribute("aria-hidden", "false");

    window.clearInterval(loadingTimer);
    loadingTimer = window.setInterval(() => {
        index = (index + 1) % messages.length;
        loadingMessage.textContent = messages[index];
    }, 1300);
}

function hideLoading() {
    window.clearInterval(loadingTimer);
    loadingTimer = null;

    if (!loadingOverlay) {
        return;
    }

    loadingOverlay.classList.remove("active");
    loadingOverlay.setAttribute("aria-hidden", "true");
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

function distanceMetricWidth(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return "18%";
    }

    return `${clamp(100 - number, 22, 100)}%`;
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
