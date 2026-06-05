library(dplyr)
library(concaveman)
library(sf)
library(smoothr)
library(jsonlite)

route_totals <- readRDS("data/route_totals.rds")
sp_aous      <- read.csv("data/bbs_sp_aous.csv")

dir.create("www/puzzles", recursive = TRUE, showWarnings = FALSE)

rts_all <- unique(route_totals$route_name)

generate_puzzle <- function(date_str) {
  # Deterministic seed from date so the same puzzle is always produced for a given day
  set.seed(as.integer(gsub("-", "", date_str)))

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

    pts_mat     <- cbind(global_check$longitude, global_check$latitude)
    hull_coords <- tryCatch(
      concaveman(pts_mat, concavity = 2),
      error = function(e) NULL
    )

    if (is.null(hull_coords) || nrow(hull_coords) < 4) next

    # Smooth the hull with Chaikin algorithm
    hull_sf     <- st_sfc(st_polygon(list(hull_coords)), crs = 4326)
    hull_smooth <- tryCatch(
      smooth(hull_sf, method = "chaikin", refinements = 3),
      error = function(e) hull_sf
    )
    hull_coords <- st_coordinates(hull_smooth)[, 1:2]

    # Build a GeoJSON Polygon
    coords_list <- lapply(seq_len(nrow(hull_coords)), function(i) {
      c(hull_coords[i, 1], hull_coords[i, 2])
    })

    puzzle <- list(
      date    = date_str,
      species = as.list(sp_names),
      hull    = list(
        type        = "Polygon",
        coordinates = list(coords_list)
      )
    )

    return(puzzle)
  }

  warning(paste("Could not generate puzzle for", date_str))
  return(NULL)
}

# Generate puzzles from today through the next 365 days
dates <- format(seq(Sys.Date(), Sys.Date() + 100, by = "day"), "%Y-%m-%d")

cat(sprintf("Generating %d puzzles...\n", length(dates)))

for (date_str in dates) {
  outfile <- file.path("www/puzzles", paste0(date_str, ".json"))
  #if (file.exists(outfile)) {
  #  cat("  skip  ", date_str, "\n")
  #  next
  #}

  puzzle <- generate_puzzle(date_str)

  if (!is.null(puzzle)) {
    write_json(puzzle, outfile, auto_unbox = TRUE, pretty = FALSE)
    cat("  ok    ", date_str, "\n")
  } else {
    cat("  FAIL  ", date_str, "\n")
  }
}

cat("Done.\n")
