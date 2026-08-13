// The eighteen city pages.
//
// Each record below carries content that is true of that city and of nowhere
// else on the list: the neighborhoods and roads we actually drive, the era
// and construction of the housing stock, what that construction means for
// carpet and for ductwork, and the access constraints a truck-mounted job runs
// into there. The shared material — method, pricing, limits — comes from the
// same catalog and disclosure text every other page uses, so it cannot drift.

export const cities = [
  {
    slug: "atlanta-ga",
    city: "Atlanta",
    county: "Fulton and DeKalb counties",
    lat: 33.749,
    lng: -84.388,
    neighbors: ["Decatur", "East Point", "College Park", "Sandy Springs"],
    blurb:
      "the city itself — intown neighborhoods, high-rise condos and pre-war bungalows",
    places:
      "Midtown, Buckhead, Virginia-Highland, Grant Park, West End, Kirkwood, Old Fourth Ward and the neighborhoods either side of the Beltline",
    housing:
      "Atlanta inside the perimeter is three housing stocks stacked on top of each other, and each one asks for something different. Pre-war bungalows in Grant Park, Kirkwood and the West End have narrow rooms, original heart-pine under decades of flooring changes, and heating systems that were retrofitted rather than designed — often an attic air handler feeding flexible runs through a knee wall. Post-war ranch houses further out have short, rigid trunk lines and crawl-space returns. Midtown and Buckhead towers are a different job again: fan-coil units in a closet, very short duct runs, and building rules about elevators and hose routes that we settle before the day.",
    soil:
      "Intown carpet takes a specific kind of beating. Front rooms open more or less directly onto the street, so grit and Atlanta's pollen load arrive on shoes before anything else does, and traffic lanes in a narrow bungalow hallway concentrate wear into a strip barely three feet wide. Pets in walkable neighborhoods come back damp and muddy far more often than pets in a fenced suburban yard. We look at how far the soil has worked down into the backing before we quote, because a lane that is gray at the tip cleans very differently from one where the grit has reached the pad.",
    route:
      "Intown jobs are decided by where the van can sit. Truck-mounted work needs a hose run from the vehicle to the room, and on a Virginia-Highland street with no driveway that means a legal curbside space within reach. In a Midtown or Buckhead building it means the loading dock, the service elevator and, often, a certificate of insurance sent to management first. Tell us the building or the street when you call and we will sort the access question before the appointment instead of on the doorstep.",
    faqs: [
      [
        "Can you clean carpet in a Midtown or Buckhead high-rise?",
        "Yes, with the building's cooperation. We need dock or curb access within hose reach and, in most managed buildings, a certificate of insurance on file with management — ours is available on request. Tell us the building when you call and we will contact management ourselves if that is easier.",
      ],
      [
        "My bungalow has an attic air handler and flexible ducts. Is that a problem?",
        "It is normal for intown housing and it changes what a cleaning can reach. Flexible runs are cleaned more gently than rigid trunk lines, some runs buried in a knee wall have no safe access point at all, and we will tell you which is which rather than reporting a run as cleaned when we could not reach it.",
      ],
    ],
  },
  {
    slug: "marietta-ga",
    city: "Marietta",
    county: "Cobb County",
    lat: 33.9526,
    lng: -84.5499,
    neighbors: ["Kennesaw", "Smyrna", "Powder Springs", "Austell"],
    blurb: "the Square, the older streets around it, and the Cobb County suburbs beyond",
    places:
      "Marietta Square, Whitlock Avenue, the Kennesaw Mountain corridor, East Cobb, Fair Oaks and the neighborhoods off Roswell Road",
    housing:
      "Marietta covers a wider span of build dates than almost anywhere else we serve. The streets radiating off the Square hold genuinely old houses — Victorian and early-century frames with high ceilings, later-added ductwork and, frequently, floor registers rather than wall or ceiling ones. East Cobb is mostly 1970s to 1990s two-story brick and siding: two air handlers is common, one per floor, which is two systems to count rather than one. Newer infill off Roswell Road runs to townhomes with a single compact system and very short runs.",
    soil:
      "Cobb County's tree cover is the thing that shows up in our work here. Oak and pine keep the pollen season long, and homes with big shade trees over the drive track more organic debris indoors than open lots do. In the older houses near the Square, floor registers act as debris traps — anything dropped or swept near one ends up in the boot below, and that is usually the first thing we show a customer when we open the system.",
    route:
      "Around the Square, driveways are short and street parking can be tight on market days, so we plan the hose run before we arrive. East Cobb is straightforward — driveways and side access are generally good. Two-story East Cobb homes usually mean carrying hose up a flight, which adds time rather than cost, and we tell you if a specific layout will stretch the appointment.",
    faqs: [
      [
        "My East Cobb house has two air handlers. Is that one price or two?",
        "Two. One system means one air handler, its trunk, its branch runs and its return. A second air handler is a second system, counted and estimated separately at the same published per-system and per-vent rates.",
      ],
      [
        "The house near the Square has floor registers. Do you clean those?",
        "Yes, and they are usually the dirtiest part of the system. Floor registers and their boots collect whatever falls or is swept toward them. We clean the accessible register, the boot and the run beyond it as far as we can safely reach, and we show you what came out.",
      ],
    ],
  },
  {
    slug: "roswell-ga",
    city: "Roswell",
    county: "Fulton County",
    lat: 34.0232,
    lng: -84.3616,
    neighbors: ["Alpharetta", "Johns Creek", "Mountain Park", "Sandy Springs"],
    blurb: "historic Canton Street, the river district, and the GA-400 corridor",
    places:
      "Canton Street, the Roswell Mill and river district, Holcomb Bridge Road, Martin's Landing, Horseshoe Bend and the neighborhoods off GA-400",
    housing:
      "Roswell splits neatly in two for our purposes. The historic core around Canton Street has older frame houses, some of them subdivided, with retrofitted systems and the access limitations that come with a conservation-minded street. The bulk of the city is 1980s and 1990s subdivision housing — Martin's Landing, Horseshoe Bend and the Holcomb Bridge corridor — where two-story homes with a basement level frequently run two systems, and where the original carpet in bedrooms and stairs has usually seen one or two cleanings already.",
    soil:
      "Homes near the Chattahoochee and its tributaries sit in more humidity than the rest of north Fulton, and humidity is the variable that decides drying time more than anything else we control. We plan extra extraction passes and talk about ventilation on river-adjacent jobs rather than quoting a drying time we cannot hold to. Basement-level carpet in this housing stock also deserves a frank look before cleaning: if a slab has been wicking moisture, cleaning will not change that, and we will say so.",
    route:
      "Canton Street and the streets immediately behind it can be genuinely tight, especially on event weekends, so we agree the parking plan when you book. Subdivision addresses off Holcomb Bridge and GA-400 are easy access with driveway parking. Where a basement is the work area, the hose run is usually down an exterior stair, which is fine as long as we know in advance.",
    faqs: [
      [
        "We are close to the river and the house feels humid. Will the carpet dry?",
        "It will, but more slowly than in a drier home, and that is worth planning around. We make additional extraction passes to remove as much moisture as the carpet and padding will release, and we ask you to run HVAC or fans afterwards. Drying time depends on carpet and padding type, soil level, humidity, airflow and temperature — we tell you what to expect for your carpet rather than quoting a fixed number.",
      ],
      [
        "There is a musty smell in the basement. Is that a duct cleaning job?",
        "Possibly not. A musty basement is usually a moisture question first. Cleaning is not remediation: if the source is moisture intrusion or active growth, that needs a qualified remediation professional and correction of the source. We will look, tell you what we see, and recommend the right trade rather than selling you a cleaning that will not fix it.",
      ],
    ],
  },
  {
    slug: "alpharetta-ga",
    city: "Alpharetta",
    county: "Fulton County",
    lat: 34.0754,
    lng: -84.2941,
    neighbors: ["Roswell", "Johns Creek", "Milton", "Cumming"],
    blurb: "Avalon, downtown, and the north Fulton technology corridor",
    places:
      "Avalon, downtown Alpharetta, Wills Park, Windward Parkway, Haynes Bridge Road and the neighborhoods off GA-400",
    housing:
      "Alpharetta is dominated by newer, larger houses than most of the metro, and size changes the job in specific ways. Windward and Haynes Bridge homes commonly run two or three air handlers across a basement, main and upper floor, which means two or three systems to count. Carpet is usually confined to bedrooms, stairs and a bonus room over the garage, with hard flooring below — so a whole-house carpet estimate here is often four or five rooms rather than eight. The Avalon and downtown apartments and townhomes are the opposite: one compact system, very short runs, and a building-access conversation.",
    soil:
      "The bonus room over the garage is the recurring story in Alpharetta. It sits above an unconditioned space, it is usually the last room to be served by the longest duct run, and its carpet is the one that shows soil first because it is where children and pets actually live. We look at that room specifically. Beyond that, north Fulton's heavy tree cover and long pollen season put a lot of organic fines into return systems, which is what most Alpharetta customers notice at the return grille.",
    route:
      "Access is generally the easiest of anywhere we work: wide driveways, side entry and space for the vehicle. The constraint here is house size rather than parking — a three-system duct job or a five-room carpet job on three floors is a longer appointment, and we would rather book the right slot than rush yours. Avalon and downtown addresses may need a dock or a certificate of insurance filed with management.",
    faqs: [
      [
        "Our house has three air handlers. How does that get priced?",
        "Per system. Each air handler with its trunk, branch runs and return is one system: the published system base plus the published per-vent rate for the vents on it. We count them on site with you before we start, so the arithmetic is visible rather than estimated.",
      ],
      [
        "Only the bedrooms and the bonus room are carpeted. Do we pay for the whole house?",
        "No. Carpet is priced per carpeted room, so a house with hard flooring downstairs pays for the rooms that actually have carpet. Stairs and a large landing are counted as two rooms. We walk it with you and count before we quote.",
      ],
    ],
  },
  {
    slug: "sandy-springs-ga",
    city: "Sandy Springs",
    county: "Fulton County",
    lat: 33.9304,
    lng: -84.3733,
    neighbors: ["Dunwoody", "Brookhaven", "Roswell", "Buckhead"],
    blurb: "the Perimeter, the river corridor, and the mid-century streets between them",
    places:
      "Perimeter Center, Roswell Road, Mount Vernon Highway, Hammond Drive, Riverside and the neighborhoods along the Chattahoochee",
    housing:
      "Sandy Springs has an unusual concentration of 1960s and 1970s split-levels and ranches alongside a dense band of Perimeter-area condos and townhomes. The split-levels matter to us because their ductwork was often built in stages: a short original trunk plus later runs to a converted lower level, sometimes with a second small air handler tucked into a closet. The Perimeter condos are single-system fan-coil jobs with short runs, building lifts and management approval.",
    soil:
      "This is a rental and turnover market as much as an owner-occupier one, particularly around Perimeter, and turnover carpet arrives with a different profile: general traffic soil across the whole floor rather than concentrated lanes, plus the marks of furniture that has just been dragged out. It is also the area where we are asked about odor most often, and it is worth being blunt — odor that has soaked into padding, subfloor or framing is being fed by a source below the surface, and a surface clean will not end it. We check depth before we quote so the expectation is right from the start.",
    route:
      "Roswell Road and Hammond Drive addresses are fine for a van; the split-level driveways are usually steep but workable. Perimeter condo work needs the dock, the service elevator and generally a certificate of insurance with the management company — send us the building name when you book and we will handle that side.",
    faqs: [
      [
        "I am turning over a Perimeter condo. Can you do carpet and ducts on the same visit?",
        "Yes, and that is the efficient way to do it. Carpet is priced per room and the duct system is priced per system plus per vent, so a one-bedroom turnover is a short, predictable job. If a dryer vent is on the list, adding it to the same visit is cheaper than a separate trip because the crew and equipment are already there.",
      ],
      [
        "The lower level of our split-level smells stale. Will duct cleaning fix it?",
        "It might help and it might not, and we will not pretend to know before we look. Stale air on a converted lower level is often about the return path, filtration or moisture rather than debris in the runs. We inspect, tell you what we find, and if it is a moisture or growth problem we say that it needs a remediation professional rather than a cleaning.",
      ],
    ],
  },
  {
    slug: "kennesaw-ga",
    city: "Kennesaw",
    county: "Cobb County",
    lat: 34.0234,
    lng: -84.6155,
    neighbors: ["Marietta", "Acworth", "Woodstock", "Dallas"],
    blurb: "the university district, Barrett Parkway, and the northwest Cobb subdivisions",
    places:
      "Kennesaw State University, Barrett Parkway, Main Street, Legacy Park, Cobb Parkway and the neighborhoods around Kennesaw Mountain",
    housing:
      "Two distinct jobs sit inside the same city here. Around Kennesaw State there is a large student-rental stock — apartments, townhomes and older houses let by the room — where turnover cleaning happens on a schedule and where carpet in bedrooms and stairs takes a year of hard wear between visits. The rest of Kennesaw is 1990s and 2000s subdivision housing: Legacy Park and the neighborhoods off Barrett Parkway, two stories, one or two systems, carpet upstairs and hard flooring down.",
    soil:
      "Student-let carpet is its own category. It arrives with heavy general soil rather than isolated spots, frequently with spill history nobody can describe, and with wear that cleaning will improve in appearance but not reverse. We are direct about that split before we start: soil comes out, matting and abrasion in the pile do not. On the subdivision side the pattern is more familiar — traffic lanes on stairs and landings, and pet activity in the family room.",
    route:
      "Barrett Parkway and Legacy Park addresses are simple driveway access. Student-let properties near the university are the ones to plan: shared parking, multiple locked bedrooms and roommates who are not all present. Tell us how access works and who will be there, and we will schedule it so the crew is not waiting on a key.",
    faqs: [
      [
        "I manage student rentals near KSU. Can you do several units in one day?",
        "Usually yes, if they are close together and access is arranged in advance. Give us the unit list and the key arrangement and we will route them together. Each unit is still priced from the same published per-room and per-system rates — there is no separate landlord rate list, higher or lower.",
      ],
      [
        "The carpet in a rental looks flattened and gray. Will cleaning fix it?",
        "Cleaning will remove the soil and improve the appearance. It will not reverse matting, abrasion in the pile, permanent dye loss or bleaching, and it will not restore fiber that has worn down. We look at the carpet, tell you which of those we are dealing with, and say what we expect to achieve before you commit.",
      ],
    ],
  },
  {
    slug: "woodstock-ga",
    city: "Woodstock",
    county: "Cherokee County",
    lat: 34.1015,
    lng: -84.5194,
    neighbors: ["Canton", "Holly Springs", "Kennesaw", "Roswell"],
    blurb: "downtown Woodstock, Towne Lake, and the I-575 corridor",
    places:
      "Downtown Woodstock, Towne Lake Parkway, Bells Ferry Road, Ridgewalk Parkway and the neighborhoods off I-575",
    housing:
      "Woodstock has grown fast and recently, and the housing shows it: a large volume of 2000s and 2010s subdivision houses around Towne Lake, plus a wave of newer townhomes and small-lot detached homes near the downtown district. Newer construction is tighter, which is good for energy and mixed for us — sealed houses recirculate the same air through the same filter, so the return side collects fines quickly, while the supply runs are often short, well-sealed and genuinely cleaner than an older system's.",
    soil:
      "Cherokee County red clay is the local signature. It tracks in on shoes and paws, it is fine enough to work straight down into the backing, and it does not rinse out the way ordinary grit does — a clay lane needs pre-treatment and more than one pass, and even then a stain that has bonded to the fiber may not fully clear. New-build homes also carry construction fines in the ductwork for the first year or two, which is the single most common reason a Woodstock homeowner calls us about ducts.",
    route:
      "Subdivision access around Towne Lake is easy. Downtown townhomes and small-lot homes are the ones where hose length matters, because the van may have to sit on the street or in a shared court rather than at the door — we will ask about that when you book. Newer neighborhoods sometimes have HOA rules about service-vehicle parking; if yours does, let us know.",
    faqs: [
      [
        "Our house is two years old. Do the ducts already need cleaning?",
        "Sometimes, and for a specific reason. New construction leaves drywall dust, sawdust and packaging fines in the system, and those show up at the registers in the first couple of years. The EPA does not recommend duct cleaning on a routine schedule, but it does list ducts with substantial deposits of dust and debris as a reason to clean — recent construction work is exactly that case. An inspection tells us whether it is warranted.",
      ],
      [
        "Red clay has been tracked across a light carpet. Can you get it out?",
        "Often much of it, not always all of it. Clay is a fine particulate that works into the backing and can bond to the fiber, so it takes pre-treatment and repeated passes. We will tell you after looking at it whether we expect a full recovery or an improvement, and we would rather set that expectation before we start than after.",
      ],
    ],
  },
  {
    slug: "douglasville-ga",
    city: "Douglasville",
    county: "Douglas County",
    lat: 33.7515,
    lng: -84.7477,
    neighbors: ["Lithia Springs", "Villa Rica", "Austell", "Fairburn"],
    blurb: "Arbor Place, the Chapel Hill corridor, and the west metro subdivisions",
    places:
      "Arbor Place, Chapel Hill Road, Stewart Parkway, Highway 5, Fairburn Road and the neighborhoods along I-20 West",
    housing:
      "West metro housing runs larger per dollar than intown, and a Douglasville carpet job is often a genuinely whole-house job — five, six or more carpeted rooms plus stairs, in a two-story house with a bonus room. Build dates cluster in the 1990s and 2000s along Chapel Hill and Stewart Parkway, with older ranch stock closer to the original town center. Single-system houses are more common here than in north Fulton, which keeps duct estimates simpler.",
    soil:
      "Larger carpeted areas change the arithmetic in a way worth saying out loud: an open-plan great room is not one room for pricing purposes if it is well over about 300 square feet, and we measure and tell you that before we start rather than after. Douglas County's clay and long pollen season put the same fines into carpet and returns as the rest of the west metro, and homes on larger wooded lots track in more organic debris than the newer tight-lot subdivisions.",
    route:
      "Access here is among the easiest we work with — driveways, side doors, room for the vehicle. Longer runs inside a large two-story house are the practical constraint, so a six-room job plus stairs is booked as a longer appointment rather than squeezed into a short slot.",
    faqs: [
      [
        "Our great room is huge and open to the kitchen. Is that one room?",
        "Probably not. A room for pricing means a single enclosed carpeted area up to roughly 300 square feet. Larger open-plan areas are measured on site and counted as more than one room — and we tell you that before we start, not when the invoice appears.",
      ],
      [
        "We have six carpeted rooms and stairs. Is there a package price?",
        "The rate is per room, so a six-room job is six rooms plus stairs counted as two. There is no volume list price hiding somewhere else on this site: one catalog, one per-room figure, and the total is just arithmetic you can check.",
      ],
    ],
  },
  {
    slug: "decatur-ga",
    city: "Decatur",
    county: "DeKalb County",
    lat: 33.7748,
    lng: -84.2963,
    neighbors: ["Atlanta", "Stone Mountain", "Tucker", "Avondale Estates"],
    blurb: "Decatur Square, the Ponce corridor, and the older DeKalb streets",
    places:
      "Decatur Square, Ponce de Leon Avenue, Scott Boulevard, Oakhurst, Winnona Park and the neighborhoods off College Avenue",
    housing:
      "Decatur's housing is older and smaller-lot than the metro average, and much of it has been renovated at least once. Oakhurst and Winnona Park bungalows have had systems added, moved and replaced, so a duct layout here is frequently a hybrid: a rigid original trunk feeding newer flexible runs to an addition, with the return path an afterthought. Second-story additions above an original single-story footprint are common, and they usually mean a second small air handler in a knee-wall closet.",
    soil:
      "Small rooms concentrate traffic. A Decatur bungalow hallway takes the same footfall as a suburban hallway three times its size, so lanes darken faster and pile flattens sooner. It is also a neighborhood with a lot of dogs and a lot of walking, which puts damp grit into the front rooms year-round. Renovated houses bring their own item: construction fines left in the ductwork from a kitchen or attic project, which is what most customers here actually want cleaned out.",
    route:
      "Decatur is the area where parking most often decides the plan. Narrow streets, short driveways and permit zones around the Square mean we need a legal spot within hose reach of your door, and on some streets that is the front curb rather than the drive. Tell us the address when you book and we will tell you whether it is straightforward.",
    faqs: [
      [
        "We just finished a renovation. Should the ducts be cleaned?",
        "That is one of the clearer cases for it. Renovation work puts drywall dust and construction fines into the system, and the EPA names ducts clogged with substantial deposits of dust and debris as a reason to clean. We inspect first, and if the deposits are not there we will tell you that rather than clean for the sake of it.",
      ],
      [
        "Our addition has its own small air handler. Two systems?",
        "Yes. Each air handler with its own trunk, runs and return is a system, priced at the published system base plus the per-vent rate for its vents. A small addition system with three or four vents is a small second figure, not a doubling — you will see the count and the arithmetic before you agree.",
      ],
    ],
  },
  {
    slug: "lawrenceville-ga",
    city: "Lawrenceville",
    county: "Gwinnett County",
    lat: 33.9562,
    lng: -83.988,
    neighbors: ["Snellville", "Lilburn", "Suwanee", "Duluth"],
    blurb: "the historic Square, Sugarloaf Parkway, and the Gwinnett County seat",
    places:
      "Lawrenceville Square, Sugarloaf Parkway, Gwinnett Place, Riverside Parkway, Highway 316 and the neighborhoods off Old Norcross Road",
    housing:
      "Lawrenceville is one of the most mixed markets we serve. The blocks around the Square hold older frame and brick houses with retrofitted systems; the Sugarloaf and Riverside corridors are 1990s to 2010s subdivision housing, often two stories with a basement and two air handlers; and there is a substantial rental and multi-family stock through the middle. Gwinnett also has more multi-generational households than most of the metro, which in practice means more rooms in active use and more carpet under load at once.",
    soil:
      "Houses in constant full use wear differently from houses that empty out at 8am. Traffic lanes appear in more rooms rather than just the hallway, kitchens adjacent to carpet track further, and a family room carpet in a full house is doing the job of a commercial corridor. We plan the pre-treatment for that rather than treating it as a light maintenance clean, and we say clearly which marks are soil, which are wear and which are permanent.",
    route:
      "Subdivision access off Sugarloaf and Riverside is straightforward. Around the Square, driveways are short and street parking is limited on weekday business hours, so we agree the plan when you book. For multi-unit or multi-generational properties, telling us the number of rooms actually in use gets you a more accurate appointment length.",
    faqs: [
      [
        "The whole house is carpeted and always occupied. Where should we start?",
        "Usually the rooms carrying the traffic: hallway, stairs, family room. Carpet is priced per room, so you can clean the rooms that need it now and the rest later without losing anything — there is no whole-house minimum being hidden by a package price.",
      ],
      [
        "Can you clean and have the rooms usable the same evening?",
        "Often, but it depends on the carpet and the day. Drying depends on carpet and padding type, soil level, humidity, airflow and temperature. Many jobs are dry to the touch within several hours. We make additional extraction passes and tell you what to expect for your carpet — we do not promise a fixed drying time.",
      ],
    ],
  },
  {
    slug: "conyers-ga",
    city: "Conyers",
    county: "Rockdale County",
    lat: 33.6676,
    lng: -84.0177,
    neighbors: ["Covington", "Lithonia", "Stonecrest", "Loganville"],
    blurb: "Olde Town, the GA-138 corridor, and Rockdale County east of the city",
    places:
      "Olde Town Conyers, GA-138, Salem Road, Sigman Road, Milstead Avenue and the neighborhoods along I-20 East",
    housing:
      "Conyers is mostly single-system housing, which makes duct estimates here about as simple as they get: one air handler, one trunk, one count of vents and returns. Olde Town has older frame houses with floor and low wall registers; the Salem Road and Sigman Road subdivisions are largely 1990s and 2000s brick-and-siding two-story homes and ranches. Basements are less common than in the north metro, so more of the ductwork runs through crawl spaces and attics — which is where accessibility becomes the deciding factor.",
    soil:
      "Crawl-space and attic runs are where we most often have to say that part of a system cannot be safely reached. Flexible duct through a tight crawl space, or a run buried behind finished ceiling with no access panel, is not something we will report as cleaned when it was not. What we do instead is document it, show you where it is, and price only the work we can actually perform. On the carpet side, Rockdale's clay behaves like Douglas County's: fine, persistent and worth pre-treating rather than hoping.",
    route:
      "Access is easy across most of Conyers — driveways and side entry. The Olde Town streets are the exception on event days. Crawl-space access is the practical variable: if the hatch is behind stored boxes, clearing it before we arrive turns a two-hour job back into a two-hour job.",
    faqs: [
      [
        "How do I know you actually cleaned the runs I cannot see?",
        "You get an account of it. We tell you which runs were cleaned, which were not accessible, and what we observed about the system's condition — moisture, damage, visible growth. A run we could not reach is reported as not reached. That written account is the deliverable as much as the cleaning is.",
      ],
      [
        "One air handler, ten vents and a return. What is that going to cost?",
        "The published system base plus the per-vent rate for each vent, which you can compute from the figures on our air duct page before you call. The current promotion covers exactly that shape of job — one system, up to ten supply vents and one return — and its full terms are on the promotion page.",
      ],
    ],
  },
  {
    slug: "stone-mountain-ga",
    city: "Stone Mountain",
    county: "DeKalb County",
    lat: 33.8081,
    lng: -84.1702,
    neighbors: ["Tucker", "Lithonia", "Snellville", "Clarkston"],
    blurb: "the village, the park side, and the Memorial Drive corridor",
    places:
      "Stone Mountain Village, Stone Mountain Park, Memorial Drive, Mountain Industrial Boulevard, Rockbridge Road and Hambrick",
    housing:
      "This is one of the older suburban stocks in the metro: a great deal of 1960s and 1970s ranch and split-level housing, plus the village's genuinely historic frame houses. Older ranches have short rigid trunk lines and, very often, the original metal register boots — which clean well but are sometimes brittle enough that we handle them carefully and tell you if one is failing. Split-levels here have the same staged-ductwork pattern we see in Sandy Springs.",
    soil:
      "Older houses in heavy tree cover give us two recurring items. First, decades of settled fines in return systems that have never been opened — this is the stock where a first-ever duct cleaning shows the most. Second, carpet that has been in place a long time, where the honest conversation is about what cleaning improves versus what has permanently changed. Twenty-year-old carpet gets cleaner; it does not get newer, and we will not imply otherwise to win the job.",
    route:
      "Village streets are narrow with short drives; the ranch subdivisions off Memorial and Rockbridge are easy access. Crawl-space and attic hatches in this stock are frequently small and occasionally full of storage, so clearing the hatch before we arrive keeps the appointment on schedule.",
    faqs: [
      [
        "The ducts have never been cleaned in forty years. Is it worth it?",
        "It is the case where an inspection is most clearly worth booking. Systems that have never been opened often hold substantial settled deposits, which is one of the conditions the EPA names as a reason to clean. We inspect, show you what is in there, and tell you what a cleaning can and cannot reach given how the system is built.",
      ],
      [
        "Some of the register boots look rusted. Will cleaning damage them?",
        "We will tell you before we touch them. Brittle vents, weakened boots and failing seals are pre-existing conditions we document rather than discover mid-job. Where a component is too far gone to clean safely, we leave it, show you, and recommend a licensed HVAC trade rather than risking the part.",
      ],
    ],
  },
  {
    slug: "snellville-ga",
    city: "Snellville",
    county: "Gwinnett County",
    lat: 33.8573,
    lng: -84.0198,
    neighbors: ["Lawrenceville", "Stone Mountain", "Loganville", "Grayson"],
    blurb: "the Town Center, the US-78 corridor, and south Gwinnett",
    places:
      "Snellville Town Center, US-78, Webb Gin House Road, Scenic Highway, Dogwood Road and the neighborhoods toward Grayson",
    housing:
      "South Gwinnett housing is largely 1980s through 2000s subdivision construction on generous lots — two-story homes, frequently with a bonus room and sometimes a finished basement. Two systems is common where a basement is finished; single-system is the norm otherwise. Carpet coverage tends to be broad in this stock: bedrooms, stairs, bonus room and often the family room, which makes for multi-room jobs rather than single-room ones.",
    soil:
      "Wooded lots and long driveways are the local variable. More tree cover means more organic litter tracked in and a longer pollen season pulled into the return, and a long driveway means grit collected on the way to the door. Family rooms in this stock also see the most pet activity of anywhere we work in Gwinnett, so the honest conversation about odor depth happens here often: if it has reached the padding or subfloor, cleaning the surface will not end it.",
    route:
      "Access is easy — wide driveways, side doors, room for the van. The practical constraint is job size: five or six carpeted rooms plus stairs across two floors is a longer appointment, and a finished basement adds a second system to the duct count. Telling us the room count and whether the basement is finished gets you an accurate slot.",
    faqs: [
      [
        "There is a pet odor in the family room carpet. Can you remove it?",
        "We can treat it and often improve it substantially, and we will not promise to eliminate it. Enzyme treatment is designed to address many common organic odor sources. But odor that has soaked into padding, subfloor or framing is being fed from below the surface, and cleaning the surface will not end it. We check the depth first and tell you what we expect before you decide.",
      ],
      [
        "Our basement is finished with its own HVAC. Two systems?",
        "Yes — two air handlers means two systems, each priced at the published system base plus its own vent count. We count them with you on site so the figure is arithmetic you can follow rather than a number we hand you.",
      ],
    ],
  },
  {
    slug: "mcdonough-ga",
    city: "McDonough",
    county: "Henry County",
    lat: 33.4473,
    lng: -84.1469,
    neighbors: ["Stockbridge", "Locust Grove", "Hampton", "Jonesboro"],
    blurb: "the Square, the GA-155 corridor, and Henry County south of the city",
    places:
      "McDonough Square, GA-155, GA-81, Jonesboro Road, Highway 20 and the neighborhoods along I-75 South",
    housing:
      "Henry County grew hard through the 2000s, and McDonough's housing reflects that: large volumes of 2000s subdivision construction on decent lots, with a historic core around the Square and a scattering of older rural properties on the edges. Most of it is single-system or, in the larger two-story homes, two. New-ish construction with original carpet is the common job — carpet at the ten-to-fifteen-year mark, where cleaning makes a real difference but cannot undo the wear.",
    soil:
      "South metro clay and a long growing season are the constants. Where McDonough differs is the proportion of homes with long unpaved or gravel driveways and outbuildings, which puts a coarser grit into the house than a paved suburban drive does — and coarse grit is abrasive, so it does more damage per year to the pile than fine dust does. Getting it out matters for the carpet's life, not just its appearance.",
    route:
      "Suburban access is easy. Rural addresses on the county's edges are worth flagging when you book, because a long or steep unpaved drive affects where the vehicle can safely sit and therefore how far the hose has to run. We would rather know before the day than work it out in your driveway.",
    faqs: [
      [
        "We are on a gravel drive out past the Square. Can you still come?",
        "Yes — we serve Henry County generally, subject to route availability. Mention the drive when you call so we can plan where the vehicle sits and how far the hose runs. Truck-mounted work needs the vehicle within hose reach of the door, and knowing in advance is the whole difference.",
      ],
      [
        "The carpet is twelve years old. Is cleaning worth it or should we replace?",
        "That is a fair question and the answer depends on what we find. Cleaning removes soil and improves appearance; it does not restore worn fiber, reverse matting or undo permanent dye loss. We will look at it, tell you which of those you are dealing with, and if the honest answer is that cleaning buys you appearance rather than years, we will say so.",
      ],
    ],
  },
  {
    slug: "stockbridge-ga",
    city: "Stockbridge",
    county: "Henry County",
    lat: 33.5443,
    lng: -84.2338,
    neighbors: ["McDonough", "Morrow", "Jonesboro", "Conyers"],
    blurb: "Eagles Landing, the GA-138 corridor, and north Henry County",
    places:
      "Eagles Landing, North Henry Boulevard, GA-138, Rock Quarry Road, Hudson Bridge Road and the neighborhoods off I-675",
    housing:
      "Stockbridge sits close enough to the airport corridor and the southern industrial belt that its housing mix skews toward a mix of owner-occupied subdivisions like Eagles Landing and a substantial rental and turnover market. Build dates run 1990s to 2000s in the main, single or dual system, two stories with carpet upstairs. Turnover work — move-in and move-out cleaning between tenancies — is a meaningful part of what we do here.",
    soil:
      "Turnover carpet is a different brief from maintenance carpet. It arrives empty, which is the best possible condition to clean in, but it also arrives with whatever the last two years left behind and no one to describe it. We inspect before quoting rather than pricing off a room count over the phone, because a bedroom with a treated pet area and a bedroom with light traffic soil are not the same job even though they are the same room count.",
    route:
      "Access is generally straightforward across Stockbridge, with driveway parking in the subdivisions. For turnover work in managed properties, tell us the key or lockbox arrangement when you book — most delays on empty-property jobs are access delays, not cleaning ones.",
    faqs: [
      [
        "I need a property cleaned between tenants. What is included?",
        "Our move-in and move-out packages have a defined scope, listed on the move cleaning page, and anything outside that scope is quoted separately rather than assumed. Cleaning is not repair, restoration or remediation: permanent stains, dye loss, worn or damaged flooring, existing paint and drywall damage may not improve. Deposit decisions are made by the landlord or management company, not by us.",
      ],
      [
        "Can you clean an empty property with the utilities off?",
        "No — truck-mounted work needs water access at the property and safe lighting to inspect and work by. Tell us if utilities are being switched and we will schedule around the date rather than turn up to a house we cannot work in.",
      ],
    ],
  },
  {
    slug: "newnan-ga",
    city: "Newnan",
    county: "Coweta County",
    lat: 33.3807,
    lng: -84.7997,
    neighbors: ["Peachtree City", "Sharpsburg", "Senoia", "Carrollton"],
    blurb: "the courthouse square, the Bullsboro corridor, and Coweta County",
    places:
      "Newnan's courthouse square, Bullsboro Drive, Jackson Street, Greenville Street, Highway 34 and the neighborhoods along I-85 South",
    housing:
      "Newnan has a genuinely historic core — the streets off the courthouse square hold some of the best-preserved nineteenth-century housing in the metro — alongside a large band of newer development out along Bullsboro Drive and Highway 34. Those are two different jobs. Historic houses mean original wood floors with area rugs rather than fitted carpet, retrofitted systems, and upholstery that is frequently old, delicate or reupholstered. Newer development is standard suburban two-story work.",
    soil:
      "The historic side is where our fiber-first approach earns its keep. Antique and reupholstered furniture, unstable dyes, silk and wool blends, and pieces that have been treated before by someone whose products we cannot identify — these need identification and a colorfastness test before anything wet is applied, and sometimes the right answer is that we decline to clean the piece. We would rather lose the job than watermark a hundred-year-old chair.",
    route:
      "Historic-district streets have short drives and mature planting, so we agree the vehicle position when you book. Bullsboro and Highway 34 subdivisions are easy access. Coweta County is toward the outer edge of our service radius, so appointments here are more sensitive to route availability than an intown job — booking a little further ahead helps.",
    faqs: [
      [
        "We have antique upholstered furniture. Will you clean it?",
        "Only after we identify the fiber and run a colorfastness test in an inconspicuous place, and only if that test says we can do it safely. Velvet, silk, viscose, linen and wool blends are often cleaned by a low-moisture method rather than extraction. Some pieces — solvent-only fabrics, unstable dyes, failing frames or seams — we decline, and we tell you why.",
      ],
      [
        "Is Newnan inside your normal service area?",
        "Yes, and it is toward the edge of it, which affects scheduling rather than pricing. The published rates are the same here as anywhere else we work. Same-day availability is less likely this far out, so give us a little more notice and we will tell you the real next opening.",
      ],
    ],
  },
  {
    slug: "peachtree-city-ga",
    city: "Peachtree City",
    county: "Fayette County",
    lat: 33.3968,
    lng: -84.5963,
    neighbors: ["Fayetteville", "Newnan", "Tyrone", "Senoia"],
    blurb: "the village layout, the cart paths, and the Fayette County lakes",
    places:
      "Aberdeen, Braelinn, Glenloch, Kedron, the Peachtree City cart-path network and the neighborhoods around Lake Peachtree",
    housing:
      "Peachtree City was master-planned in villages, and the housing reflects the decade each village was built: Aberdeen and Glenloch older, Braelinn and Kedron newer, all of it set back into heavy tree cover with cart paths rather than pavements between them. Two-story homes with two systems are common, as are finished basements. It is also the metro's most golf-cart-dependent town, which is genuinely relevant to us: carts bring outdoor grit right up to a garage entry that people walk through in shoes.",
    soil:
      "Tree cover here is dense enough to shape the work. Pollen season is long and heavy, so return systems load up with organic fines faster than in open subdivisions, and that is what most Peachtree City customers notice first at the return grille. On the carpet side the recurring pattern is a grit lane from the garage door inward, fed by cart use and path walking — a concentrated, abrasive band that benefits from pre-treatment rather than a single pass.",
    route:
      "Village streets are quiet and access is generally good, with driveway parking. The thing to know is that cart paths are not vehicle routes: we need road and driveway access to the house, not path access. Where a home's practical entry is from the path side, tell us and we will plan the hose run from the road.",
    faqs: [
      [
        "Pollen is heavy here every spring. Will duct cleaning help?",
        "It can reduce the accumulated debris in the accessible parts of the system, and that is all we will claim for it. What arrives each spring comes in through doors, windows and the return path, so filtration, filter change intervals and duct sealing matter at least as much as cleaning does. We are not going to tell you that a cleaning solves a pollen season, and if your concern is a health symptom, that is a conversation for a physician.",
      ],
      [
        "There is a dark band of carpet from the garage door. What is that?",
        "Concentrated grit in a traffic lane, usually with an abrasive component from outdoor paths and cart use. It responds to pre-treatment and repeated passes better than to a single one. Where the grit has abraded the pile itself, cleaning will lift the soil but the wear stays — we will tell you which part of what you are seeing is which.",
      ],
    ],
  },
  {
    slug: "fayetteville-ga",
    city: "Fayetteville",
    county: "Fayette County",
    lat: 33.4487,
    lng: -84.4549,
    neighbors: ["Peachtree City", "Jonesboro", "Riverdale", "Brooks"],
    blurb: "the courthouse district, the GA-85 corridor, and rural Fayette County",
    places:
      "the Fayette County courthouse district, GA-85, GA-54, Lester Road, Redwine Road and the neighborhoods toward Brooks",
    housing:
      "Fayetteville mixes a small historic center with 1990s-to-2010s subdivisions along GA-85 and GA-54, and then thins out quickly into genuinely rural Fayette County — larger lots, longer drives, well water in places, and outbuildings. The rural end is where the job changes: bigger houses with more carpeted rooms, sometimes two or three systems, and access that has to be planned rather than assumed.",
    soil:
      "Rural Fayette properties bring in a coarser and more varied soil load than suburban ones: gravel grit, pasture and garden debris, and more pet traffic in and out through a mud room that may be carpeted. Coarse grit is the abrasive kind, which does real damage to pile over years — removing it protects the carpet's life as much as its look. Homes on well water are worth mentioning when you book, because mineral content affects what we do with rinse and spotting products.",
    route:
      "Subdivision access along GA-85 and GA-54 is easy. Rural addresses need a conversation: a long gravel drive, a gate code, or a house set well back from the road all affect where the vehicle sits and whether the hose reaches. Fayette County's outer edge is also more sensitive to route availability, so book with a little more notice.",
    faqs: [
      [
        "We are on well water on a large lot. Does that change anything?",
        "It can, so tell us when you book. Truck-mounted work draws water at the property, and mineral content affects rinse behavior and product selection. A long drive also changes where the vehicle can sit and how far the hose has to run. None of it is a problem we cannot plan for — it is only a problem when we find out on the day.",
      ],
      [
        "Do you charge more for coming out to a rural address?",
        "The published rates are the same everywhere we work; there is one catalog and no distance surcharge hidden in it. What distance affects is availability — same-day openings this far out are less likely, and we will tell you the real next opening rather than promising one we cannot keep.",
      ],
    ],
  },
];
