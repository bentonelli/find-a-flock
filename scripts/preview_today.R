library(dplyr)
library(concaveman)
library(sf)
library(smoothr)
library(jsonlite)
library(dbscan)

route_totals <- readRDS("data/route_totals.rds")
sp_aous      <- read.csv("data/bbs_sp_aous.csv")

SEED_SALT <- 9999
rts_all   <- unique(route_totals$route_name)

# Build one smoothed hull from a set of row indices into pts_orig.
# Adds 30km cardinal satellite points before computing the concave hull.
make_hull_coords <- function(pts_orig, rows) {
  pts           <- pts_orig[rows, , drop = FALSE]
  km_to_deg_lat <- 30 / 111.12
  offsets <- do.call(rbind, lapply(seq_len(nrow(pts)), function(i) {
    lat <- pts[i, 2]; lon <- pts[i, 1]
    km_to_deg_lon <- 30 / (111.12 * cos(lat * pi / 180))
    rbind(c(lon,                lat + km_to_deg_lat),
          c(lon,                lat - km_to_deg_lat),
          c(lon + km_to_deg_lon, lat),
          c(lon - km_to_deg_lon, lat))
  }))
  mat    <- rbind(pts, offsets)
  coords <- tryCatch(concaveman(mat, concavity = 2), error = function(e) NULL)
  if (is.null(coords) || nrow(coords) < 4) return(NULL)
  hull_sf <- st_sfc(st_polygon(list(coords)), crs = 4326)
  hull_sm <- tryCatch(smooth(hull_sf, method = "chaikin", refinements = 3),
                      error = function(e) hull_sf)
  st_coordinates(hull_sm)[, 1:2]
}

generate_puzzle <- function(date_str) {
  set.seed(as.integer(gsub("-", "", date_str)) + SEED_SALT)

  for (attempt in 1:30) {
    wildcard_route <- sample(rts_all, 1)

    route_birds <- route_totals %>%
      filter(route_name == wildcard_route, aou %in% sp_aous$AOU) %>%
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

    # Cluster observation points by geographic proximity (500 km threshold)
    pts_sf      <- st_as_sf(as.data.frame(pts_orig), coords = c("V1", "V2"), crs = 4326)
    dist_km     <- as.dist(units::drop_units(st_distance(pts_sf)) / 1000)
    cluster_ids <- dbscan(dist_km, eps = 500, minPts = 1)$cluster

    # Build one hull per cluster
    unique_clusters <- sort(unique(cluster_ids))
    hull_list <- Filter(Negate(is.null), lapply(unique_clusters, function(cl) {
      make_hull_coords(pts_orig, which(cluster_ids == cl))
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

    n_clusters <- length(hull_list)
    cat(sprintf("  %s — %d cluster(s), %d obs points\n", date_str, n_clusters, nrow(pts_orig)))

    return(puzzle)
  }

  warning(paste("Could not generate puzzle for", date_str))
  return(NULL)
}

# Regenerate the Roseate Spoonbill puzzle into the preview slot
puzzle <- generate_puzzle("2026-06-14")

if (!is.null(puzzle)) {
  outfile <- "docs/puzzles/2027-06-06.json"
  write_json(puzzle, outfile, auto_unbox = TRUE, pretty = FALSE)
  cat("Written to", outfile, "\n")
  cat("Load with: ?test=1&date=2027-06-06\n")
} else {
  cat("FAILED to generate puzzle\n")
}
