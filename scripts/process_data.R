library(bbsBayes2)
library(dplyr)

bbs_in <- load_bbs_data(level = "stop", release = 2025, sample = FALSE, quiet = TRUE)

bbs_in_all <- bbs_in[[1]]

bbs_in_all <- bbs_in_all %>% 
  mutate(total_seen = rowSums(.[8:57]))

bbs_in_all <- bbs_in_all %>% select(route_data_id,country_num,state_num,route,rpid,year,aou,total_seen)

bbs_in_all <- bbs_in_all %>% 
  filter(year >= 2010)

route_totals <- bbs_in_all %>%
  group_by(country_num,state_num,route,aou) %>%
  summarise(cross_year_average = mean(total_seen))

route_info <- bbs_in[[2]]  %>%
  select(country_num,state_num,route,route_name,latitude,longitude,bcr,rpid) %>%
  unique()

route_totals <- merge(route_totals,route_info,by=c("country_num","state_num","route"))

saveRDS(route_totals,"route_totals.rds")