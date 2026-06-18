library(dplyr)
library(concaveman)
library(sf)
library(smoothr)
library(jsonlite)
library(dbscan)

route_totals <- readRDS("data/route_totals_80.rds")
sp_aous      <- read.csv("data/bbs_sp_aous.csv")

dir.create("docs/puzzles", recursive = TRUE, showWarnings = FALSE)

SEED_SALT <- 9999  # increment to regenerate all puzzles with a new set

rts_all     <- unique(route_totals$route_name)
game_region <- st_read("docs/region.geojson", quiet = TRUE)

# Build one smoothed hull from a set of row indices into pts_orig.
# Adds 50km cardinal satellite points before computing the concave hull.
make_satellites <- function(pts_orig) {
  do.call(rbind, lapply(seq_len(nrow(pts_orig)), function(i) {
    lat <- pts_orig[i, 2]; lon <- pts_orig[i, 1]
    km  <- if (lat > 60) 400 else if (lat > 50) 200 else 60
    km_to_deg_lat <- km / 111.12
    km_to_deg_lon <- km / (111.12 * cos(lat * pi / 180))
    rbind(c(lon,                lat + km_to_deg_lat),
          c(lon,                lat - km_to_deg_lat),
          c(lon + km_to_deg_lon, lat),
          c(lon - km_to_deg_lon, lat))
  }))
}

make_hull_coords <- function(pts) {
  coords <- tryCatch(concaveman(pts, concavity = 2.5), error = function(e) NULL)
  if (is.null(coords) || nrow(coords) < 4) return(NULL)
  hull_sf <- st_sfc(st_polygon(list(coords)), crs = 4326)
  hull_sm <- tryCatch(smooth(hull_sf, method = "chaikin", refinements = 4),
                      error = function(e) hull_sf)
  hull_clip <- tryCatch({
    clipped <- st_intersection(hull_sm, st_geometry(game_region))
    if (length(clipped) == 0 || all(st_is_empty(clipped))) hull_sm else {
      polys <- st_cast(clipped, "POLYGON", warn = FALSE)
      polys[which.max(st_area(polys))]
    }
  }, error = function(e) hull_sm)
  st_coordinates(hull_clip)[, 1:2]
}

generate_puzzle <- function(date_str) {
  # Deterministic seed from date so the same puzzle is always produced for a given day
  set.seed(as.integer(gsub("-", "", date_str)) + SEED_SALT)

  for (attempt in 1:30) {
    wildcard_route <- sample(rts_all, 1)

    route_birds <- route_totals %>%
      filter(route_name == wildcard_route, aou %in% sp_aous$AOU & cross_year_average>1) %>%
      arrange(cross_year_average)

    if (nrow(route_birds) < 5) next

    bins       <- cut(seq_len(nrow(route_birds)), breaks = 5)
    ind_chosen <- tapply(seq_len(nrow(route_birds)), bins, function(v) sample(v, 1))
    brds       <- route_birds$aou[ind_chosen]

    sp_names <- sp_aous$eBird_common_name[sp_aous$AOU %in% brds]
    if (length(sp_names) < 5) next

    global_check <- route_totals %>%
      filter(aou %in% brds) %>%
      group_by(country_num, state_num, route, route_name, latitude, longitude) %>%
      summarise(count = n(), .groups = "drop") %>%
      filter(count >= 5)

    if (nrow(global_check) < 4) next

    pts_orig <- cbind(global_check$longitude, global_check$latitude)
    all_pts  <- rbind(pts_orig, make_satellites(pts_orig))

    # Cluster on all points (original + satellite) by geographic proximity (500 km threshold)
    mean_lat    <- mean(all_pts[, 2])
    scaled_pts  <- cbind(all_pts[, 1] * cos(mean_lat * pi / 180), all_pts[, 2])
    dist_km     <- dist(scaled_pts) * 111.12
    cluster_ids <- dbscan(dist_km, eps = 700, minPts = 1)$cluster

    # Build one hull per cluster
    unique_clusters <- sort(unique(cluster_ids))
    hull_list <- Filter(Negate(is.null), lapply(unique_clusters, function(cl) {
      make_hull_coords(all_pts[which(cluster_ids == cl), , drop = FALSE])
    }))

    if (length(hull_list) == 0) next

    coords_to_list <- function(h) lapply(seq_len(nrow(h)), function(i) c(h[i, 1], h[i, 2]))

    hull_geom <- if (length(hull_list) == 1) {
      list(type = "Polygon", coordinates = list(coords_to_list(hull_list[[1]])))
    } else {
      list(type = "MultiPolygon",
           coordinates = lapply(hull_list, function(h) list(coords_to_list(h))))
    }

    puzzle <- list(
      date    = date_str,
      species = as.list(sp_names),
      hull    = hull_geom
    )

    return(puzzle)
  }

  warning(paste("Could not generate puzzle for", date_str))
  return(NULL)
}

# Generate puzzles from tomorrow through the next 366 days
dates <- format(seq(Sys.Date() + 1, Sys.Date() + 366, by = "day"), "%Y-%m-%d")

cat(sprintf("Generating %d puzzles...\n", length(dates)))

for (date_str in dates) {
  outfile <- file.path("docs/puzzles", paste0(date_str, ".json"))

  puzzle <- generate_puzzle(date_str)

  if (!is.null(puzzle)) {
    write_json(puzzle, outfile, auto_unbox = TRUE, pretty = FALSE)
    cat("  ok    ", date_str, "\n")
  } else {
    cat("  FAIL  ", date_str, "\n")
  }
}

cat("Done.\n")
