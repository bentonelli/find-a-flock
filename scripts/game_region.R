library(bbsBayes2)
library(dplyr)
library(sf)
library(terra)
library(concaveman)
library(smoothr)

# Pick a route, pick some species
route_region <- readRDS("route_totals.rds") %>%
  select(longitude,latitude) %>%
  unique()

pts_mat <- cbind(route_region$longitude, route_region$latitude)
hull_concave <- concaveman(pts_mat, concavity = 2,length_threshold = 5)  # higher = more convex

plot(hull_concave,type="l")
points(pts_mat)

sp_aous <- read.csv("~/Documents/Coding/R/Main/BBS_pheno/Data/L0/BBS/bbs_sp_aous.csv")

rts_all <- unique(route_totals$route_name)

wildcard_route <- sample(rts_all,1)

route_birds <- route_totals %>%
  filter(route_name == wildcard_route & aou %in% sp_aous$AOU) %>%
  arrange(cross_year_average)

#Pick common birds and rare birds

#Split into five buckets
bins <- cut(1:nrow(route_birds), breaks = 5)
ind_chosen <- tapply(1:nrow(route_birds), bins, function(v) sample(v, 1))

brds <- route_birds$aou[ind_chosen]

sp_names <- sp_aous$eBird_common_name[which(sp_aous$AOU %in% brds)]

print(sp_names)

#Now figure out locations of all routes with this combo of birds
global_check <- route_totals %>% 
  filter(aou %in% brds) %>%
  group_by(country_num,state_num,route,route_name,latitude,longitude) %>%
  summarise(count = n()) %>%
  filter(count >= 5)

plot(global_check$longitude,global_check$latitude)

pts_mat <- cbind(global_check$longitude, global_check$latitude)
hull_concave <- concaveman(pts_mat, concavity = 2)  # higher = more convex

# Convert result to SpatVector
hull_vect <- vect(hull_concave, type = "polygons", crs = "EPSG:4326")
plot(hull_vect)
points(global_check$longitude,global_check$latitude)
