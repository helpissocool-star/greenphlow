import geopandas as gpd
import pandas as pd


subs = gpd.read_file("subcatchments.geojson")
sites = gpd.read_file("candidate_gi_sites.geojson") 

if subs.crs is None or subs.crs.to_epsg() != 4326:
    subs = subs.to_crs(4326)
if sites.crs is None or sites.crs.to_epsg() != 4326:
    sites = sites.to_crs(4326)

runoff = pd.read_csv("runoff_results.csv")          
flood_scores = pd.read_csv("code2_final_flood_scores.csv")  
budget = pd.read_csv("site_costs.csv")               
selection = pd.read_csv("knapsack_selection.csv")    

subs = subs.merge(runoff, on="subcatchment_id", how="left")

sites = sites.merge(flood_scores[["site_id", "gi_type", "flood_attenuation_score"]],
                     on="site_id", how="left")
sites = sites.merge(budget[["site_id", "site_cost"]], on="site_id", how="left")
sites = sites.merge(selection[["site_id", "selected"]], on="site_id", how="left")
sites["selected"] = sites["selected"].fillna(0).astype(int)

subs.to_file("web_subcatchments.geojson", driver="GeoJSON")
sites.to_file("web_candidate_sites.geojson", driver="GeoJSON")

print("Wrote data/web_subcatchments.geojson and data/web_candidate_sites.geojson")
