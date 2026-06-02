let selectedMarker = null;
let map = null;

const selectedLocationText = document.getElementById("selected-location");
const latInput = document.getElementById("lat");
const lonInput = document.getElementById("lon");
const resultsDiv = document.getElementById("results");
const runButton = document.getElementById("run-button");
const mapBox = document.getElementById("map");

mapBox.style.minHeight = "380px";
mapBox.style.display = "block";
initMap();

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
    showStatusMessage("Running analysis... This can take a few moments.");

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
    const confidence = formatNumber(data.confidence);
    const area = formatNumber(data.area);
    const distance = formatNumber(data.distance);
    const jsonOutput = escapeHtml(JSON.stringify(data.json_output || data, null, 2));
    const verdict = data.has_solar
        ? "Solar panels detected in the selected rooftop buffer."
        : "No verifiable solar panel was detected for this location.";

    resultsDiv.innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div>
                    <h3>Analysis result</h3>
                    <p class="result-description">${escapeHtml(verdict)} Sample ${escapeHtml(data.sample_id || "WEB")} was analyzed at ${lat.toFixed(6)}, ${lon.toFixed(6)}.</p>
                </div>
                <span class="badge ${statusClass}">${escapeHtml(data.status || "UNKNOWN")}</span>
            </div>

            <div class="result-summary">
                <div>
                    <span>Solar detected</span>
                    <strong>${data.has_solar ? "Yes" : "No"}</strong>
                </div>
                <div>
                    <span>Saved report</span>
                    <strong>${escapeHtml(data.sample_id || "N/A")}</strong>
                </div>
            </div>

            <div class="meta">
                <div>
                    <span>Confidence</span>
                    <strong>${confidence}</strong>
                </div>
                <div>
                    <span>PV Area (sqm)</span>
                    <strong>${area}</strong>
                </div>
                <div>
                    <span>Distance (m)</span>
                    <strong>${distance}</strong>
                </div>
                <div>
                    <span>Inference mode</span>
                    <strong>${escapeHtml(data.inference_mode || "N/A")}</strong>
                </div>
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

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
