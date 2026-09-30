# Third-party data and asset attribution

This notice describes material included in, queried by, or used to derive the
Local Bubble catalogue. It is not a substitute for the upstream terms; those
terms control if they differ. `data_manifest.yaml` records query-level
provenance and retrieval times.

| Material in this repository | Upstream terms / required attribution |
| --- | --- |
| SIMBAD cache responses and SIMBAD-derived object metadata | SIMBAD is made available under the [Open Database License (ODbL)](https://simbad.cds.unistra.fr/simbad/). Cite: “This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France” and Wenger et al. (2000), as appropriate. |
| Gaia-derived metadata | Gaia data are open and free to use with credit to `ESA/Gaia/DPAC`. Include the Gaia acknowledgement and cite the Gaia mission and relevant data-release papers. See [Gaia credit instructions](https://gea.esac.esa.int/archive/documentation/GDR3/Miscellaneous/sec_credit_and_citation_instructions/). |
| VizieR queries and cached catalogues, including Zucker et al. (2020), Tarricq et al. (2022), and Cantat-Gaudin et al. (2020) tables | Cite the original catalogue/paper and the VizieR access service: “This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France” (DOI: [10.26093/cds/vizier](https://doi.org/10.26093/cds/vizier)). Individual catalogue terms and publication rights continue to apply. |
| NASA Exoplanet Archive cache | Cite the [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) and the per-record literature references. The archive aggregates published data; its upstream provenance remains applicable. |
| `data/raw/galaxy_map/galaxymap_solar_neighbourhood_800pc_2020.jpg` and the candidate-name transcription derived from it | Kevin Jardine / galaxymap.org, “[Gaia star density map — the solar neighbourhood and environs within 800 parsecs](https://commons.wikimedia.org/wiki/File:Galaxymap.com,_map_of_the_solar_neighbourhood_800_parsecs_(2020).jpg),” [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Give credit, link the licence, and indicate changes. The image incorporates Gaia mission data; retain the applicable Gaia credit. |
| RECONS “The 100 Nearest Star Systems” candidate list | Research Consortium on Nearby Stars (RECONS), “[The 100 Nearest Star Systems](https://www.astro.gsu.edu/RECONS/TOP100.posted.htm),” retrieved 2026-08-18. The project uses this only to select names; positions and physical values are resolved independently. No explicit reuse licence was located: retain this attribution and obtain permission before redistributing the RECONS-derived candidate list independently. |
| Literature-derived values and `Radcliffe_Wave_best_fit_model_Konietzka2024.tab` | Cite the source paper and DOI recorded in the relevant model, record, or README. The underlying publication/supplement terms apply; do not treat this repository's code licence as a licence for a copied table. |

## Project assets

`web/public/og-image.jpg` is an original Local Bubble renderer output and is
covered by the project-created-material terms in `DATA_LICENSE.md`. It depicts
data subject to the attributions above.

## Dependency note

Software dependencies are governed by their own package licences. In
particular, the web viewer depends on Three.js; package metadata and lockfiles
identify exact versions. This document covers data and visual assets, not a
replacement for dependency licence notices.

