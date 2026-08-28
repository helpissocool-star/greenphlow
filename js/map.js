/* ============================================================
   GreenPHlow — Leaflet map application
   ------------------------------------------------------------
   Expects two GeoJSON files in /data, already merged with your
   Python outputs (see merge_for_web.py). Adjust the FIELD NAMES
   below if your merged files use different column names.
   ============================================================ */

// ---- CONFIG: map these to your actual merged field names ----
const FIELDS = {
  subcatchmentId: "subcatchment_id",
  cnComposite: "cn_composite",
  runoff2yr: "runoff_2yr_mm",     // or volume_2yr_m3 if you prefer volume-based shading
  runoff5yr: "runoff_5yr_mm",
  runoff10yr: "runoff_10yr_mm",

  siteId: "site_id",
  siteSubcatchmentId: "subcatchme",
  giType: "gi_type",               // final chosen GI type per site
  siteArea: "area_sqm",
  floodScore: "flood_attenuation_score",
  siteCost: "site_cost",
  funded: "selected",              // boolean/1-0 from knapsack output
  barangay: "barangay",            // add this field via QGIS join before it'll show real data
};

const GI_COLORS = {
  bioswale: "#2b7fb8",
  permeable_pavement: "#8a8a8a",
  urban_forest_patch: "#1e7a34",
};

let map, subcatchmentLayer, siteLayer, legendControl;
let subcatchmentData, siteData;
let siteLayersById = {};
let currentShadeField = "runoff_10yr_mm";
let currentGiFilter = "all";
let currentFundedFilter = "all";

// Optional extra QGIS reference layers, shown/hidden via the layer control.
// Add or remove entries here to match whatever files you export from QGIS.
// Any file that fails to load is skipped silently (so it's safe to list
// layers you haven't exported yet).
const EXTRA_LAYERS = [
  { file: "data/land_cover.geojson", label: "Land Cover", color: "#8a9a5b", fillOpacity: 0.5 },
  { file: "data/hsg.geojson", label: "Hydrologic Soil Group", color: "#5b7a9a", fillOpacity: 0.4 },
  { file: "data/slope_suitable.geojson", label: "Slope-Suitable Areas", color: "#c98a2b", fillOpacity: 0.4 },
  { file: "data/drainage_buffer.geojson", label: "Drainage Buffer", color: "#2b6ac9", fillOpacity: 0.4 },
];

async function loadData() {
  const [subRes, siteRes] = await Promise.all([
    fetch("data/web_subcatchments.geojson"),
    fetch("data/web_candidate_sites.geojson"),
  ]);
  subcatchmentData = await subRes.json();
  siteData = await siteRes.json();
}

async function loadExtraLayers() {
  const layerControlEntries = {};

  for (const cfg of EXTRA_LAYERS) {
    try {
      const res = await fetch(cfg.file);
      if (!res.ok) continue; // file not exported yet — skip quietly
      const geojson = await res.json();
      const layer = L.geoJSON(geojson, {
        style: { color: cfg.color, weight: 1, fillOpacity: cfg.fillOpacity },
      });
      layerControlEntries[cfg.label] = layer;
      // not added to map by default — user turns them on via the control
    } catch (e) {
      console.warn(`Skipping ${cfg.file}:`, e);
    }
  }

  if (Object.keys(layerControlEntries).length > 0) {
    L.control.layers(null, layerControlEntries, { collapsed: false }).addTo(map);
  }
}

function initMap() {
  map = L.map("map", { zoomControl: true });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);
}

function getShadeValue(feature) {
  return feature.properties[currentShadeField];
}

function colorScale(value, allValues) {
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const t = max > min ? (value - min) / (max - min) : 0.5;
  // light yellow -> deep red ramp
  const stops = [
    [255, 247, 188],
    [254, 196, 79],
    [217, 95, 14],
    [153, 0, 0],
  ];
  const idx = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const localT = t * (stops.length - 1) - idx;
  const c = stops[idx].map((v, i) =>
    Math.round(v + (stops[idx + 1][i] - v) * localT)
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function drawSubcatchments() {
  if (subcatchmentLayer) map.removeLayer(subcatchmentLayer);

  const allValues = subcatchmentData.features.map(getShadeValue);

  subcatchmentLayer = L.geoJSON(subcatchmentData, {
    style: (feature) => ({
      fillColor: colorScale(getShadeValue(feature), allValues),
      weight: 1,
      color: "#555",
      fillOpacity: 0.75,
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(`
        <b>Subcatchment ${p[FIELDS.subcatchmentId]}</b><br/>
        Composite CN: ${fmt(p[FIELDS.cnComposite])}<br/>
        Runoff (2-yr): ${fmt(p[FIELDS.runoff2yr])} mm<br/>
        Runoff (5-yr): ${fmt(p[FIELDS.runoff5yr])} mm<br/>
        Runoff (10-yr): ${fmt(p[FIELDS.runoff10yr])} mm
      `);
    },
  }).addTo(map);

  map.fitBounds(subcatchmentLayer.getBounds());
  updateLegend(allValues);
}

function passesFilters(props) {
  const giOk =
    currentGiFilter === "all" ||
    String(props[FIELDS.giType]).toLowerCase().replace(/\s+/g, "_") === currentGiFilter;
  const fundedVal = props[FIELDS.funded];
  const isFunded = fundedVal === true || fundedVal === 1 || fundedVal === "1";
  const fundedOk =
    currentFundedFilter === "all" ||
    (currentFundedFilter === "funded" && isFunded) ||
    (currentFundedFilter === "unfunded" && !isFunded);
  return giOk && fundedOk;
}

function drawSites() {
  if (siteLayer) map.removeLayer(siteLayer);
  siteLayersById = {};

  const filtered = {
    type: "FeatureCollection",
    features: siteData.features.filter((f) => passesFilters(f.properties)),
  };

  siteLayer = L.geoJSON(filtered, {
    pointToLayer: (feature, latlng) => {
      const p = feature.properties;
      const fundedVal = p[FIELDS.funded];
      const isFunded = fundedVal === true || fundedVal === 1 || fundedVal === "1";
      return L.circleMarker(latlng, {
        radius: isFunded ? 7 : 5,
        fillColor: GI_COLORS[p[FIELDS.giType]] || "#999",
        color: isFunded ? "#000" : "#666",
        weight: isFunded ? 2 : 1,
        fillOpacity: isFunded ? 0.9 : 0.5,
      });
    },
    style: (feature) => {
      // for polygon candidate sites instead of points
      const p = feature.properties;
      const fundedVal = p[FIELDS.funded];
      const isFunded = fundedVal === true || fundedVal === 1 || fundedVal === "1";
      return {
        fillColor: GI_COLORS[p[FIELDS.giType]] || "#999",
        color: isFunded ? "#000" : "#666",
        weight: isFunded ? 2 : 1,
        fillOpacity: isFunded ? 0.9 : 0.5,
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const fundedVal = p[FIELDS.funded];
      const isFunded = fundedVal === true || fundedVal === 1 || fundedVal === "1";
      siteLayersById[p[FIELDS.siteId]] = layer;
      layer.bindPopup(`
        <b>Site ${p[FIELDS.siteId]}</b> (Subcatchment ${p[FIELDS.siteSubcatchmentId]})<br/>
        Barangay: ${p[FIELDS.barangay] || "—"}<br/>
        GI type: ${labelize(p[FIELDS.giType])}<br/>
        Area: ${fmt(p[FIELDS.siteArea])} m&sup2;<br/>
        Flood attenuation score: ${fmt(p[FIELDS.floodScore])}<br/>
        Estimated cost: ₱${fmt(p[FIELDS.siteCost])}<br/>
        Status: <b>${isFunded ? "Funded" : "Not funded"}</b>
      `);
    },
  }).addTo(map);
}

function updateLegend(allValues) {
  if (legendControl) map.removeControl(legendControl);

  legendControl = L.control({ position: "bottomright" });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const steps = 4;
    let html = `<b>${labelize(currentShadeField)}</b><br/>`;
    for (let i = 0; i < steps; i++) {
      const v = min + ((max - min) * i) / (steps - 1);
      html += `<i style="background:${colorScale(v, allValues)}"></i>${fmt(v)}<br/>`;
    }
    div.innerHTML = html;
    return div;
  };
  legendControl.addTo(map);
}

function updateSummary() {
  const funded = siteData.features.filter((f) => {
    const v = f.properties[FIELDS.funded];
    return v === true || v === 1 || v === "1";
  });
  const totalCost = funded.reduce(
    (sum, f) => sum + (Number(f.properties[FIELDS.siteCost]) || 0),
    0
  );
  const avgScore =
    funded.length > 0
      ? funded.reduce(
          (sum, f) => sum + (Number(f.properties[FIELDS.floodScore]) || 0),
          0
        ) / funded.length
      : 0;

  document.getElementById("summary-content").innerHTML = `
    <div class="stat"><div class="value">${siteData.features.length}</div><div class="label">Candidate sites</div></div>
    <div class="stat"><div class="value">${funded.length}</div><div class="label">Sites funded</div></div>
    <div class="stat"><div class="value">₱${fmt(totalCost)}</div><div class="label">Total budget used</div></div>
    <div class="stat"><div class="value">${fmt(avgScore)}</div><div class="label">Avg. flood score (funded)</div></div>
  `;
}

function fmt(v) {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function labelize(s) {
  if (!s) return "—";
  return String(s)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function attachControls() {
  document.getElementById("layerSelect").addEventListener("change", (e) => {
    currentShadeField = FIELDS[
      { runoff_2yr: "runoff2yr", runoff_5yr: "runoff5yr",
        runoff_10yr: "runoff10yr", cn_composite: "cnComposite" }[e.target.value]
    ];
    drawSubcatchments();
  });

  document.getElementById("giTypeFilter").addEventListener("change", (e) => {
    currentGiFilter = e.target.value;
    drawSites();
  });

  document.getElementById("fundedFilter").addEventListener("change", (e) => {
    currentFundedFilter = e.target.value;
    drawSites();
  });

  const searchInput = document.getElementById("siteSearch");
  const resultsBox = document.getElementById("searchResults");

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    resultsBox.innerHTML = "";
    if (q.length === 0) {
      resultsBox.classList.remove("open");
      return;
    }

    const matches = siteData.features.filter((f) => {
      const p = f.properties;
      const idMatch = String(p[FIELDS.siteId]).toLowerCase().includes(q);
      const brgyMatch = String(p[FIELDS.barangay] || "").toLowerCase().includes(q);
      return idMatch || brgyMatch;
    }).slice(0, 10);

    if (matches.length === 0) {
      resultsBox.innerHTML = `<div class="search-result-item empty">No matching sites</div>`;
      resultsBox.classList.add("open");
      return;
    }

    matches.forEach((f) => {
      const p = f.properties;
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.innerHTML = `<b>Site ${p[FIELDS.siteId]}</b> — ${p[FIELDS.barangay] || "Barangay unknown"} · ${labelize(p[FIELDS.giType])}`;
      item.addEventListener("click", () => goToSite(p[FIELDS.siteId]));
      resultsBox.appendChild(item);
    });
    resultsBox.classList.add("open");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-group")) {
      resultsBox.classList.remove("open");
    }
  });
}

function goToSite(siteId) {
  // Show all sites regardless of current filters, so the searched-for
  // site is guaranteed to be visible even if it's e.g. unfunded and the
  // funding filter was set to "Funded only".
  currentGiFilter = "all";
  currentFundedFilter = "all";
  document.getElementById("giTypeFilter").value = "all";
  document.getElementById("fundedFilter").value = "all";
  drawSites();

  const layer = siteLayersById[siteId];
  if (!layer) return;

  const center = layer.getLatLng ? layer.getLatLng() : layer.getBounds().getCenter();
  map.setView(center, 18);
  layer.openPopup();

  document.getElementById("searchResults").classList.remove("open");
  document.getElementById("siteSearch").value = "";
}

async function main() {
  initMap();
  await loadData();
  drawSubcatchments();
  drawSites();
  updateSummary();
  attachControls();
  await loadExtraLayers();
}

main();
