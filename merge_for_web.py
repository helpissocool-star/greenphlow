"""
GreenPHlow — merge Python outputs onto QGIS geometries for the website.
Run this after code #1-4 have produced their final CSVs.

Adjust the file names / column names below to match what your
groupmates actually exported.
"""

import geopandas as gpd
import pandas as pd

# ---- Load geometries (from QGIS, Marikina-clipped, EPSG:4326 for web) ----
subs = gpd.read_file("subcatchments.geojson")
sites = gpd.read_file("candidate_gi_sites.geojson")  # your final candidate sites layer

if subs.crs is None or subs.crs.to_epsg() != 4326:
    subs = subs.to_crs(4326)
if sites.crs is None or sites.crs.to_epsg() != 4326:
    sites = sites.to_crs(4326)

# ---- Load computed results ----
runoff = pd.read_csv("runoff_results.csv")          # code #1
flood_scores = pd.read_csv("code2_final_flood_scores.csv")  # code #2
budget = pd.read_csv("site_costs.csv")               # code #3
selection = pd.read_csv("knapsack_selection.csv")    # code #4

# ---- Merge onto subcatchments ----
subs = subs.merge(runoff, on="subcatchment_id", how="left")

# ---- Merge onto candidate sites ----
# barangay comes through automatically here — it should already be a field
# on candidate_gi_sites.geojson from the QGIS "Join Attributes by Location"
# step against the barangay boundary layer. No merge needed for it.
sites = sites.merge(flood_scores[["site_id", "gi_type", "flood_attenuation_score"]],
                     on="site_id", how="left")
sites = sites.merge(budget[["site_id", "site_cost"]], on="site_id", how="left")
sites = sites.merge(selection[["site_id", "selected"]], on="site_id", how="left")
sites["selected"] = sites["selected"].fillna(0).astype(int)

# ---- Simplify geometry slightly for web performance (optional) ----
# subs["geometry"] = subs.geometry.simplify(0.00005, preserve_topology=True)

# ---- Export for the website ----
subs.to_file("web_subcatchments.geojson", driver="GeoJSON")
sites.to_file("web_candidate_sites.geojson", driver="GeoJSON")

print("Wrote data/web_subcatchments.geojson and data/web_candidate_sites.geojson")
