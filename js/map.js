const FIELDS = {
  subcatchmentId: "subcatchment_id",
  cnComposite: "cn_composite",
  runoff2yr: "runoff_2yr_mm",    
  runoff5yr: "runoff_5yr_mm",
  runoff10yr: "runoff_10yr_mm",
  volume2yr: "volume_2yr_m3",
  volume5yr: "volume_5yr_m3",
  volume10yr: "volume_10yr_m3",

  siteId: "site_id",
  siteSubcatchmentId: "subcatchment_id",
  giType: "gi_type_x",               
  siteArea: "area_m2",
  mrr2yr: "MRR_2yr_m3",
  mrr5yr: "MRR_5yr_m3",
  mrr10yr: "MRR_10yr_m3",
  siteCost: "site_cost",
  funded2yr: "selected_2yr",
  funded5yr: "selected_5yr",
  funded10yr: "selected_10yr",          
  barangay: "brgy_name",          
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
let currentScenario = "10yr"; // "2yr", "5yr", "10yr"

const EXTRA_LAYERS = [
  { file: "data/land_cover.geojson", label: "Land Cover", color: "#8a9a5b", fillOpacity: 0.5 },
  { file: "data/hsg.geojson", label: "Hydrologic Soil Group", color: "#5b7a9a", fillOpacity: 0.4 },
  { file: "data/slope_suitable.geojson", label: "Slope-Suitable Areas", color: "#c98a2b", fillOpacity: 0.4 },
  { file: "data/drainage_buffer.geojson", label: "Drainage Buffer", color: "#2b6ac9", fillOpacity: 0.4 },
];

async function loadData() {
  let subRes, siteRes;
  
  // Try multiple possible paths to locate the exported files
  const paths = [
    { sub: "data/web_subcatchments.geojson", site: "data/web_candidate_sites.geojson" },
    { sub: "web_subcatchments.geojson", site: "web_candidate_sites.geojson" },
    { sub: "./web_subcatchments.geojson", site: "./web_candidate_sites.geojson" }
  ];

  for (const p of paths) {
    try {
      subRes = await fetch(p.sub);
      siteRes = await fetch(p.site);
      if (subRes.ok && siteRes.ok) {
        console.log(`Successfully loaded GeoJSON from path: ${p.sub}`);
        break;
      }
    } catch (e) {
      // Try next path
    }
  }

  if (!subRes || !subRes.ok || !siteRes || !siteRes.ok) {
    document.getElementById("summary-content").innerHTML = `
      <span style="color: #b91c1c; font-weight: 500;">
        GeoJSON files not found! Ensure <code>web_subcatchments.geojson</code> and <code>web_candidate_sites.geojson</code> are pushed to your GitHub repository.
      </span>`;
    throw new Error("Could not find web GeoJSON files in any path.");
  }

  subcatchmentData = await subRes.json();
  siteData = await siteRes.json();
}

async function loadExtraLayers() {
  const layerControlEntries = {};

  for (const cfg of EXTRA_LAYERS) {
    try {
      const res = await fetch(cfg.file);
      if (!res.ok) continue; 
      const geojson = await res.json();
      const layer = L.geoJSON(geojson, {
        style: { color: cfg.color, weight: 1, fillOpacity: cfg.fillOpacity },
      });
      layerControlEntries[cfg.label] = layer;
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

  // Use standard OpenStreetMap tiles (no API key required)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function getShadeValue(feature) {
  return Number(feature.properties[currentShadeField]) || 0;
}

function colorScale(value, allValues) {
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const t = max > min ? (value - min) / (max - min) : 0.5;
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
        <b>Subcatchment ${p[FIELDS.subcatchmentId] || "—"}</b><br/>
        Composite CN: ${fmt(p[FIELDS.cnComposite])}<br/>
        Runoff (2-yr): ${fmt(p[FIELDS.runoff2yr])} mm (${fmt(p[FIELDS.volume2yr])} m&sup3;)<br/>
        Runoff (5-yr): ${fmt(p[FIELDS.runoff5yr])} mm (${fmt(p[FIELDS.volume5yr])} m&sup3;)<br/>
        Runoff (10-yr): ${fmt(p[FIELDS.runoff10yr])} mm (${fmt(p[FIELDS.volume10yr])} m&sup3;)
      `);
    },
  }).addTo(map);

  map.fitBounds(subcatchmentLayer.getBounds());
  updateLegend(allValues);
}

function isSiteFundedForScenario(props, scenario) {
  const fieldName = FIELDS[`funded${scenario}`];
  const val = props[fieldName];
  return val === true || val === 1 || val === "1" || val === "True";
}

function passesFilters(props) {
  const giOk =
    currentGiFilter === "all" ||
    String(props[FIELDS.giType]).toLowerCase().replace(/\s+/g, "_") === currentGiFilter;
  
  let fundedOk = true;
  if (currentFundedFilter === "funded_2yr") fundedOk = isSiteFundedForScenario(props, "2yr");
  else if (currentFundedFilter === "unfunded_2yr") fundedOk = !isSiteFundedForScenario(props, "2yr");
  else if (currentFundedFilter === "funded_5yr") fundedOk = isSiteFundedForScenario(props, "5yr");
  else if (currentFundedFilter === "unfunded_5yr") fundedOk = !isSiteFundedForScenario(props, "5yr");
  else if (currentFundedFilter === "funded_10yr") fundedOk = isSiteFundedForScenario(props, "10yr");
  else if (currentFundedFilter === "unfunded_10yr") fundedOk = !isSiteFundedForScenario(props, "10yr");

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
      const isFunded = isSiteFundedForScenario(p, currentScenario);
      return L.circleMarker(latlng, {
        radius: isFunded ? 7 : 5,
        fillColor: GI_COLORS[p[FIELDS.giType]] || "#999",
        color: isFunded ? "#000" : "#666",
        weight: isFunded ? 2 : 1,
        fillOpacity: isFunded ? 0.9 : 0.5,
      });
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const isFunded = isSiteFundedForScenario(p, currentScenario);
      siteLayersById[p[FIELDS.siteId]] = layer;
      
      const mrrField = FIELDS[`mrr${currentScenario}`];
      
      layer.bindPopup(`
        <b>Site ${p[FIELDS.siteId] || "—"}</b> (Subcatchment ${p[FIELDS.siteSubcatchmentId] || "—"})<br/>
        Barangay: ${p[FIELDS.barangay] || "—"}<br/>
        GI type: ${labelize(p[FIELDS.giType])}<br/>
        Area: ${fmt(p[FIELDS.siteArea])} m&sup2;<br/>
        MRR (${currentScenario}): ${fmt(p[mrrField])} m&sup3;<br/>
        Estimated cost: ₱${fmt(p[FIELDS.siteCost])}<br/>
        Status (${currentScenario}): <b>${isFunded ? "Funded" : "Not funded"}</b>
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
  const funded = siteData.features.filter((f) => isSiteFundedForScenario(f.properties, currentScenario));
  const totalCost = funded.reduce(
    (sum, f) => sum + (Number(f.properties[FIELDS.siteCost]) || 0),
    0
  );
  const mrrField = FIELDS[`mrr${currentScenario}`];
  const avgMrr =
    funded.length > 0
      ? funded.reduce(
          (sum, f) => sum + (Number(f.properties[mrrField]) || 0),
          0
        ) / funded.length
      : 0;

  document.getElementById("summary-content").innerHTML = `
    <div class="stat"><div class="value">${siteData.features.length}</div><div class="label">Candidate sites</div></div>
    <div class="stat"><div class="value">${funded.length}</div><div class="label">Sites funded (${currentScenario})</div></div>
    <div class="stat"><div class="value">₱${fmt(totalCost)}</div><div class="label">Total budget used</div></div>
    <div class="stat"><div class="value">${fmt(avgMrr)} m&sup3;</div><div class="label">Avg. MRR (${currentScenario})</div></div>
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
    const val = e.target.value;
    const keyMap = {
      runoff_2yr: "runoff2yr", runoff_5yr: "runoff5yr", runoff_10yr: "runoff10yr",
      volume_2yr: "volume2yr", volume_5yr: "volume5yr", volume_10yr: "volume10yr",
      cn_composite: "cnComposite"
    };
    currentShadeField = FIELDS[keyMap[val]];
    drawSubcatchments();
  });

  const scenarioSelect = document.getElementById("scenarioSelect");
  if (scenarioSelect) {
    scenarioSelect.addEventListener("change", (e) => {
      currentScenario = e.target.value; // "2yr", "5yr", "10yr"
      drawSites();
      updateSummary();
    });
  }

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
  try {
    initMap();
    await loadData();
    drawSubcatchments();
    drawSites();
    updateSummary();
    attachControls();
    await loadExtraLayers();
  } catch (e) {
    console.error("Initialization halted:", e);
  }
}

main();
