library(dplyr)
library(concaveman)
library(sf)
library(smoothr)
library(jsonlite)

route_totals <- readRDS("data/route_totals.rds")

route_region <- route_totals %>%
  select(longitude, latitude) %>%
  unique()

pts_mat <- cbind(route_region$longitude, route_region$latitude)

# Build concave hull
hull_coords <- concaveman(pts_mat, concavity = 3, length_threshold = 5)

# Convert to sf polygon
hull_sf <- st_sfc(st_polygon(list(hull_coords)), crs = 4326)

# Smooth with Chaikin algorithm
hull_smooth <- smooth(hull_sf, method = "chaikin", refinements = 1)

# Preview
plot(hull_smooth, col = NA, border = "steelblue", lwd = 2)
points(pts_mat, pch = ".", col = "grey40")

# Export as GeoJSON for the web app
hull_fc <- st_sf(geometry = hull_smooth)
st_write(hull_fc, "www/region.geojson", driver = "GeoJSON", delete_dsn = TRUE)

cat("Saved www/region.geojson\n")
