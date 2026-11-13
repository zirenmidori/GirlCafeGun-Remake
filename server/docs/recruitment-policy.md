# Recruitment and collection policy

The policy budgets 50 daily draws for each weekly rotation banner and
10 for each other available banner. With the standard and Railgun character
banners active, that is 70 character draws and 60 weapon draws each day. Mail
contains ordinary ten-pull tickets shared within each category; players decide
which banners to spend them on. A new player's welcome mail separately includes
200 character draws and 200 weapon draws.

`resources/gacha/recruitment-policy.json` controls the daily budget and selector
interval. The normal random draw rates and pity rules remain unchanged. The
character rotation uses the standard 3% Legendary rate and 50-pull pity. The
weapon rotation uses its standard 3% rate; its original pool has no hard pity.

Each 100 qualifying rotation draws earns a selector for that category. Partial
progress carries into the next window. Character and weapon progress are
independent, start at zero when this feature is installed, and exclude draws on
other banners. Spending failures do not advance progress. A selector's choices
are permanently bound to the lineup active when it was earned; changing weeks
does not change an unopened box. Existing definitions are immutable. Future
lineup revisions must allocate new definitions and retain previous ones.

Selectors allow choosing an already-owned item for progression as well as
filling a collection gap. They do not change normal draw outcomes or reset pity.
The stock selection interface is used to open them.

## Collection odds

The largest current lineups contain five Legendary characters and three
Legendary weapons. These calculations start with none of those items and zero
character pity. They use only the draws budgeted for the rotation, excluding
welcome gifts and tickets budgeted for other banners.

| Daily draws into each rotation | Character collection, random draws only | Weapon collection, random draws only |
| ------------------------------ | --------------------------------------: | -----------------------------------: |
| 20                             |                                   8.42% |                               42.87% |
| 50                             |                                  71.76% |                               91.35% |
| 100                            |                                  98.25% |                               99.74% |
| 150                            |                                  99.90% |                               99.99% |

With 50 daily rotation draws and a selector every 100, a player who immediately
uses each selector for a missing item has about **99.963%** probability of
collecting all five characters within seven days. Three weapon selectors
guarantee all three weapons by 300 draws if each selects a missing weapon.
Saving character selectors until after the week's random draws further improves
the collection chance. Spending tickets elsewhere, choosing duplicates, or not
claiming/using the week's supply changes these outcomes.

The character calculation tracks the number of distinct Legendary items and
the current pity count after each draw. A Legendary draw resets pity, a new
Legendary increments the distinct count, and a selector increments that count
without changing pity. At 49 consecutive non-Legendary draws, the next draw is
Legendary. Both normal draws and the tenth-draw hedge use the published 3%
Legendary rate before that guarantee. All Legendary rows in a rotation have
equal weights. Absorbing completed collections retain their full probability.

The 26 seven-day cohorts repeat every 182 days. All 222 eligible character cards
and 134 eligible weapons appear; the stock oath and currently gameplay-obtainable
cards remain excluded. The immutable selector catalog contains only the
Legendary subset of each cohort.
