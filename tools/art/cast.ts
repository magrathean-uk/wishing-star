// The cast list for art: one entry per look. Descriptions carry no names (the image tool refuses named characters,
// and real people may only be described by the PEOPLE.md prompt description, copied word for word).
// `desc` is the faithful description; `soft` is a plainer wording tried when the first is refused.

export type ArtRole = 'hero' | 'walker' | 'fixed' | 'speakingMob' | 'hostile' | 'animal' | 'boss';
export type ArtBody = 'biped' | 'quad' | 'bird' | 'blob' | 'spider';
export type ArtStyle = 'show' | 'person' | 'block' | 'toy' | 'kawaii' | 'crayon';

export interface CastArt {
  id: string;
  role: ArtRole;
  body: ArtBody;
  style: ArtStyle;
  desc: string;
  soft?: string;
  /** the hero's own emote, drawn as four cheer frames */
  emote?: string;
  /** another character's model image shown as a style reference, for families that share one look */
  family?: string;
  /** height on screen in tiles */
  tall: number;
  group: string;
  cameo?: boolean;
  /** how this look draws each facing, when the plain front, side and back views do not fit it */
  views?: { down?: string; side?: string; up?: string };
  /** drawn facing front only (the side and back sheets were refused): it waddles towards the camera whichever way it goes */
  frontOnly?: boolean;
  /** clips the game plays that this look draws with another clip's frames, as { played: drawn } */
  alias?: Record<string, string>;
  /** a hand-made sheet list instead of the role's layout */
  layout?: 'forky';
  /**
   * A picture from the other game's assets shown to the image tool as a likeness reference (D21, D24): never shipped,
   * never copied into the repo. Absolute, or relative to the home folder when it starts with "~/".
   */
  likeness?: string;
  /** an extra drawing note added to every sheet prompt (for a look the model image alone does not settle, such as long hair seen from behind) */
  sheetNote?: string;
}

const c: CastArt[] = [];
const add = (
  id: string,
  role: ArtRole,
  body: ArtBody,
  style: ArtStyle,
  tall: number,
  group: string,
  desc: string,
  extra: Partial<CastArt> = {},
) => c.push({ id, role, body, style, tall, group, desc, ...extra });

// Peppa's family in their show's own flat look (G asked for them by name): side-on heads, flat colours, crayon outline.
const PIG_LOOK =
  'drawn in a very flat simple preschool cartoon look: the head is seen side-on (in profile) even when the body faces us, with both small round eyes on the same side of the face, the snout a round flat disc at the very front of the head with two nostril dots, a small curved smile on the cheek, two small pointed ears on top, a pink cheek blush; a round body; very thin stick arms and legs; a slightly wobbly crayon-like dark outline; flat colours with no shading';
const PIG_SOFT =
  'very flat simple preschool cartoon: profile head with both eyes on one side, a round flat snout disc at the front, a small curved smile, a round body, thin stick arms and legs, wobbly crayon outline, flat colours';
const PIG_VIEWS = {
  down: 'FRONT VIEW: the round body faces the viewer while the head stays side-on in profile, snout pointing right (the way this cartoon always draws heads)',
  side: 'SIDE VIEW (profile), body and head facing RIGHT, snout pointing right',
  up: 'BACK VIEW (seen from behind, walking away from the viewer): the back of the round body and head, the snout just showing at the side, a small curly tail',
};

// ---------------------------------------------------------------- heroes
add('amelia', 'hero', 'biped', 'person', 1.75, 'hero_amelia', 'a friendly cartoon person', {
  emote: 'a happy twirl with arms out',
  sheetNote: 'the same look in every view',
});
add('koala', 'hero', 'biped', 'toy', 1.3, 'hero_koala', 'a friendly cartoon person', {
  emote: 'a roly-poly tumble and a little clap',
});
add(
  'bluey',
  'hero',
  'biped',
  'show',
  1.7,
  'hero_bluey',
  'a cheerful cartoon blue heeler puppy standing upright on two legs like a child: mid-blue fur, darker navy-blue pointed ears, back and tail tip, a warm cream-tan muzzle and eyebrow dots, pale blue chest, belly and paws, rectangular rounded body and head in one block shape, short legs, small dark nose, happy smile',
  {
    soft: 'a cheerful blue cartoon puppy standing on two legs, block-shaped body, darker blue ears and back, cream-tan muzzle, pale tummy',
    likeness: '~/dev/amelia-gpt/game/assets/bluey.webp',
    emote: 'a silly wiggly dance',
  },
);
add(
  'bing',
  'hero',
  'biped',
  'show',
  1.5,
  'hero_bing',
  'a small black toy-like bunny toddler in a soft preschool cartoon style: black fur, long upright black ears with tan swirl marks inside, big round friendly eyes, small pink nose, pale muzzle; wearing plain orange-red dungarees with one round yellow button on the bib over a green t-shirt, and small dark shoes',
  {
    soft: 'a small black bunny toddler with long ears, in plain orange-red dungarees with a yellow button and a green t-shirt, soft preschool cartoon',
    likeness: '~/dev/amelia-gpt/game/assets/bing.webp',
    emote: 'a bouncy bunny hop with both arms up',
  },
);
add(
  'flop',
  'hero',
  'biped',
  'toy',
  1.15,
  'hero_flop',
  'a small knitted soft toy carer in orange wool with a fine knitted texture, shaped like a skittle: a small round head on a narrow neck that widens into a wide round pear-shaped bottom, two very long upright dark brown ears with rounded tips that flop a little at the top, short dark brown arms with rounded ends, small dark brown rounded feet, a simple face with two small black oval eyes, a tiny dark nose and a small gentle smile',
  {
    soft: 'a small orange knitted soft toy shaped like a skittle, with two long dark brown ears, dark brown arms and feet, dot eyes and a small smile',
    emote: 'a calm little bow',
    likeness: '~/dev/amelia-gpt/game/assets/flop.webp',
  },
);
add(
  'peppa',
  'hero',
  'biped',
  'crayon',
  1.6,
  'hero_peppa',
  `a little pink piglet girl in a plain red dress and black shoes, ${PIG_LOOK}`,
  {
    soft: `a little pink piglet girl in a plain red dress, ${PIG_SOFT}`,
    views: PIG_VIEWS,
    emote: 'jumping up and down in a muddy puddle with a big splash',
  },
);
add(
  'woody',
  'hero',
  'biped',
  'toy',
  2.2,
  'hero_woody',
  'a friendly cowboy rag doll toy with long thin floppy limbs, a brown cowboy hat, a yellow checked shirt, a cow-print waistcoat with a star badge, a red neckerchief, blue jeans and brown boots',
  { emote: 'tipping his hat with a big grin', likeness: '~/dev/amelia-gpt/game/assets/woody.webp' },
);
add(
  'buzz',
  'hero',
  'biped',
  'toy',
  2,
  'hero_buzz',
  'a stocky toy space ranger action figure: a grown-up face with a big square jaw, a cleft chin and a confident smile, a close-fitting purple cap that covers all of the head (no hair showing), a clear round dome helmet over the head, a white space suit with lime-green and purple panels, a chest panel with a few small coloured buttons, a black ribbed waist, white legs with green and purple boots',
  {
    soft: 'a stocky toy spaceman with a square jaw, a purple cap on his head under a clear dome helmet, a white suit with green and purple panels',
    emote: 'a proud salute with wings popping out',
    likeness: '~/dev/amelia-gpt/game/assets/buzz.webp',
  },
);
add(
  'jessie',
  'hero',
  'biped',
  'toy',
  2.1,
  'hero_jessie',
  'a cheerful slim cowgirl toy doll with a smooth friendly painted face (no stitches, no button eyes): big green eyes, rosy cheeks and a wide happy smile; long red hair in one long braid tied with a yellow bow, a red cowgirl hat with a white band, a white shirt with a yellow collar and cuffs and red swirls, cow-print chaps over blue jeans, a belt with a gold buckle and brown boots; long legs',
  {
    soft: 'a cheerful slim cowgirl doll with a friendly painted face, a red hat, a long red braid with a yellow bow, a white and yellow shirt, cow-print chaps and boots',
    emote: 'a big yee-ha jump with one arm swinging',
    likeness: '~/dev/amelia-gpt/game/assets/jessie.webp',
  },
);
add(
  'hello_kitty',
  'hero',
  'biped',
  'kawaii',
  1.6,
  'hero_hello_kitty',
  'a cute kawaii white kitten character: large round white head with two small pointed ears, a big red bow on one ear, two small black oval eyes set wide apart, a tiny yellow oval nose, three whiskers on each cheek, no mouth; small body wearing blue dungarees over a red top. Thick black outline',
  {
    soft: 'a cute white cartoon kitten with a red bow on one ear, dot eyes, a yellow nose, whiskers and blue dungarees',
    emote: 'a sweet wave with both paws and a little hop',
  },
);
add(
  'kuromi',
  'hero',
  'biped',
  'kawaii',
  1.6,
  'hero_kuromi',
  'a small cute kawaii character with a white face and white body: she wears a black hood that covers all of her head, with two tall pointed black ears that end in small round knobs, and a small pink skull mark on the front of the hood; cheeky slanted black eyes, a small pink nose, a sly smile, a small black pointed devil tail, short white arms and legs, a black collar. Thick black outline',
  {
    soft: 'a cute cheeky kawaii character with a white face in a black hood with two pointed ears and a small pink skull mark, and a little pointed tail',
    emote: 'a cheeky cackle with a hand over her mouth',
    likeness: '~/dev/amelia-gpt/game/assets/kuromi.webp',
  },
);
add(
  'gabby',
  'hero',
  'biped',
  'show',
  1.8,
  'hero_gabby',
  'a friendly cartoon girl with long curly brown hair (no coloured tips), wearing a headband with cat ears, a black and white striped top under a pink jacket, blue jeans and pink trainers',
  {
    soft: 'a friendly cartoon girl with curly brown hair, a cat-ears headband, a striped top, a pink jacket and jeans',
    likeness: '~/dev/amelia-gpt/game/assets/gabby.webp',
    emote: 'sparkly jazz hands',
  },
);
add(
  'paddington',
  'hero',
  'biped',
  'show',
  1.8,
  'hero_paddington',
  'a small polite brown bear cub standing upright: soft brown fur, round face with a dark nose, wearing an old red bush hat, a blue duffel coat with wooden toggles and a paper luggage label round his neck, carrying a small battered brown suitcase',
  {
    soft: 'a small polite brown bear in a red hat and a blue duffel coat, carrying a little suitcase',
    emote: 'raising his hat politely',
  },
);
add(
  'bob',
  'hero',
  'biped',
  'show',
  1.35,
  'hero_bob',
  'a small round yellow jellybean-shaped helper creature with goggles and blue dungarees, cheerful and silly, simple cartoon',
  { soft: 'a funny little round yellow creature in goggles and blue overalls', emote: 'a giggling wobble dance' },
);

// ---------------------------------------------------------------- Bluey's family
add(
  'bandit',
  'walker',
  'biped',
  'show',
  2.2,
  'heeler',
  'a tall cartoon blue heeler father dog standing upright on two legs: mid-blue fur with a dark navy back, ears and top of the head, a warm cream-tan muzzle, pale blue chest, belly and paws, tan eyebrow dots, rectangular rounded body and head in one block shape, long legs, friendly tired smile',
  {
    family: 'bluey',
    soft: 'a tall blue cartoon dad dog standing on two legs, block-shaped body, dark navy back and ears, cream-tan muzzle',
  },
);
add(
  'chilli',
  'walker',
  'biped',
  'show',
  2.1,
  'heeler',
  'a tall cartoon red heeler mother dog standing upright on two legs: warm orange-red fur with a darker brown-orange back and ears, cream muzzle, chest, belly and paws, rectangular rounded body and head in one block shape, long legs, kind smile',
  {
    family: 'bluey',
    soft: 'a tall orange cartoon mum dog standing on two legs, block-shaped body, cream muzzle and tummy',
  },
);
add(
  'bingo',
  'walker',
  'biped',
  'show',
  1.5,
  'heeler',
  'a small cartoon red heeler puppy standing upright on two legs like a little child: warm orange-red fur with darker orange ear tips and back patch, cream muzzle, chest, belly, paws and tail tip, small squat rectangular rounded body and head in one block shape, sweet smile',
  {
    family: 'bluey',
    soft: 'a small orange cartoon puppy standing on two legs, block-shaped body, cream muzzle and tummy',
  },
);

// ---------------------------------------------------------------- Peppa's family
add(
  'mummy_pig',
  'walker',
  'biped',
  'crayon',
  2,
  'peppa',
  `a kind pink mother pig in a plain orange dress and black shoes, ${PIG_LOOK}`,
  { family: 'peppa', soft: `a kind pink mother pig in a plain orange dress, ${PIG_SOFT}`, views: PIG_VIEWS },
);
add(
  'daddy_pig',
  'walker',
  'biped',
  'crayon',
  2.2,
  'peppa',
  `a big round jolly pink father pig in a plain turquoise top, with round black glasses and a stubbly chin drawn as little dark dots, black shoes, ${PIG_LOOK}`,
  {
    family: 'peppa',
    soft: `a big round jolly pink father pig in a turquoise top with round glasses and a stubbly chin, ${PIG_SOFT}`,
    views: PIG_VIEWS,
  },
);
add(
  'george',
  'walker',
  'biped',
  'crayon',
  1.3,
  'peppa',
  `a very small pink piglet boy in a plain blue top and black shoes, holding a small green toy dinosaur, ${PIG_LOOK}`,
  {
    family: 'peppa',
    soft: `a very small pink piglet boy in a plain blue top holding a green toy dinosaur, ${PIG_SOFT}`,
    views: PIG_VIEWS,
  },
);

// ---------------------------------------------------------------- Bing's friends
add(
  'sula',
  'walker',
  'biped',
  'show',
  1.5,
  'bing',
  'a small toy-like elephant toddler girl in a soft preschool cartoon style: grey-brown skin, big round ears, a short trunk, big friendly eyes; wearing a pink and yellow dress, magenta socks and golden shoes',
  { family: 'bing' },
);
add(
  'pando',
  'walker',
  'biped',
  'show',
  1.5,
  'bing',
  'a small toy-like panda toddler boy in a soft preschool cartoon style: black and white fur, black eye patches and ears, big friendly eyes; wearing a white t-shirt, yellow shorts and black shoes',
  { family: 'bing' },
);
add(
  'coco',
  'walker',
  'biped',
  'show',
  1.7,
  'bing',
  // white (G, D40): the first drawing is current again; the orange-brown one is kept as *-rejected-2
  'a toy-like white rabbit girl, a bit taller and older, in a soft preschool cartoon style: white fur, long upright ears with pink inner ears, big friendly eyes; wearing a purple dress with a yellow flower and stripy tights',
  {
    family: 'bing',
    soft: 'a white cartoon bunny girl with long ears in a purple dress with a yellow flower, soft preschool style',
  },
);

// ---------------------------------------------------------------- koalas
add(
  'mama_koala',
  'walker',
  'biped',
  'show',
  1.9,
  'gum',
  'a kind cartoon mother koala standing upright: soft grey fur, big fluffy round ears, a large black oval nose, a white chest, gentle sleepy eyes, wearing a small green leaf-patterned scarf',
);
add(
  'joey',
  'animal',
  'biped',
  'show',
  0.9,
  'gum',
  'a tiny cute baby koala: soft grey fur, big fluffy ears, a black oval nose, big shiny eyes, sitting and toddling upright',
  { alias: { hop: 'cheer' } },
);

// ---------------------------------------------------------------- Toy Box Corner
add(
  'rex',
  'walker',
  'biped',
  'toy',
  2.2,
  'home',
  'a friendly nervous plastic toy tyrannosaurus dinosaur standing upright on two legs: a big head with a long snout and a wide grin showing a row of small white teeth, small eyes with worried brows, tiny short arms held up, a big body leaning a little forward, a pale yellow-green belly, thick strong back legs with three-clawed feet and a long tapering tail; bright grass green with darker green scales',
  {
    soft: 'a friendly worried-looking green toy tyrannosaurus with a toothy grin, tiny arms, strong legs and a long tail',
    likeness: '~/dev/amelia-gpt/game/assets/rex.webp',
  },
);
add(
  'hamm',
  'fixed',
  'quad',
  'toy',
  1.2,
  'home',
  'a round pink toy piggy bank with a big smile, small dark eyes, a coin slot on his back, a cork stopper in his belly and short stubby legs',
);
add(
  'slinky',
  'walker',
  'quad',
  'toy',
  1.1,
  'home',
  'a toy dog with a stretchy metal coil spring for a body: brown plastic head with long floppy darker ears, a black nose and a green collar, brown front and back paws, a small springy tail, friendly droopy eyes',
  {
    soft: 'a brown toy sausage dog whose middle is a metal spring, with a green collar',
    likeness: '~/dev/amelia-gpt/game/assets/slinky.webp',
  },
);
add(
  'potato',
  'fixed',
  'biped',
  'toy',
  1.5,
  'home',
  'a toy potato man: a brown potato-shaped body with big round eyes, a big orange nose, a black moustache, red lips, pink ears, a black bowler hat, white arms and blue shoes',
  { soft: 'a funny toy potato man with a bowler hat, a moustache and stick-on face parts' },
);
add(
  'bo_peep',
  'walker',
  'biped',
  'toy',
  2.1,
  'plains',
  'a kind porcelain shepherdess figurine toy: blonde hair in a bun with a pink bow, a pale blue jumpsuit with a wide pink belt, a purple cape, holding a blue shepherd crook',
  { soft: 'a kind shepherdess doll with a crook, blonde hair, a pale blue outfit and a purple cape' },
);
add(
  'alien',
  'fixed',
  'biped',
  'toy',
  1.3,
  'home',
  'a small squeaky toy alien: round green body, three big round eyes, pointed ears, one little antenna on top, wearing a blue space suit with a purple collar',
  { soft: 'a small green toy alien with three eyes and one antenna in a blue suit' },
);
add(
  'forky',
  'fixed',
  'biped',
  'toy',
  1.2,
  'home',
  'a home-made craft toy: a white plastic spork with mismatched googly eyes, a blue clay mouth, a red pipe-cleaner for arms and feet made of two broken lolly sticks',
  {
    cameo: true,
    layout: 'forky',
    soft: 'a funny home-made toy: a white plastic fork-spoon with two wobbly googly eyes, a blue clay smile, red pipe-cleaner arms and two little wooden lolly-stick legs',
  },
);
add(
  'bullseye',
  'animal',
  'quad',
  'toy',
  1.8,
  'home',
  'a goofy gangly toy horse: a lanky chestnut-brown body, very long thin legs with dark brown hooves, a long neck, a big goofy face with a long muzzle, big round eyes and a wide toothy grin, a short shaggy dark brown mane, a dark brown tail, a brown saddle with yellow stirrups',
  {
    soft: 'a goofy long-legged brown toy horse with a big grinning face, a dark brown mane and a saddle',
    likeness: '~/dev/amelia-gpt/game/assets/bullseye.webp',
  },
);

// ---------------------------------------------------------------- Sanrio
add(
  'mimmy',
  'walker',
  'biped',
  'kawaii',
  1.6,
  'square',
  'a cute kawaii white kitten character: large round white head with two small pointed ears, a big yellow bow on one ear, two small black oval eyes set wide apart, a tiny yellow oval nose, three whiskers on each cheek, no mouth; small body wearing a pink dress. Thick black outline',
  {
    family: 'hello_kitty',
    soft: 'a cute white cartoon kitten with a yellow bow on one ear, dot eyes, whiskers and a pink dress',
  },
);
add(
  'baku',
  'walker',
  'biped',
  'kawaii',
  1.3,
  'square',
  'a cute kawaii round purple tapir creature: plump lilac-purple body, a short trunk-like snout with a paler tip, small round ears, tiny wings, dot eyes and a gentle sleepy smile. Thick dark outline',
);

// ---------------------------------------------------------------- Minions
add(
  'kevin',
  'walker',
  'biped',
  'show',
  1.8,
  'bay',
  'a tall thin yellow pill-shaped helper creature with two eyes behind goggles, a small tuft of hair on top and blue dungarees, cheerful and silly, simple cartoon',
  {
    family: 'bob',
    soft: 'the tall big brother of the creature in Image 1: the same kind of funny yellow creature in goggles and blue overalls, but taller and thinner, with a little tuft of hair',
  },
);
add(
  'stuart',
  'walker',
  'biped',
  'show',
  1.5,
  'bay',
  'a yellow pill-shaped helper creature with one big eye behind a single goggle, flat combed hair and blue dungarees, cheerful and silly, simple cartoon',
  { family: 'bob' },
);
add(
  'minion_d',
  'walker',
  'biped',
  'show',
  1.6,
  'bay',
  'a yellow pill-shaped helper creature with two eyes behind goggles, neatly parted hair and blue dungarees, grinning, simple cartoon',
  {
    family: 'bob',
    soft: 'a friend of the creature in Image 1: the same kind of funny yellow creature in goggles and blue overalls, a bit taller, with neat combed hair and a big grin',
  },
);
add(
  'minion_e',
  'walker',
  'biped',
  'show',
  1.4,
  'bay',
  'a short plump yellow pill-shaped helper creature with two eyes behind goggles, spiky hair and blue dungarees, laughing, simple cartoon',
  { family: 'bob' },
);

// ---------------------------------------------------------------- Gabby's Dollhouse friends
add(
  'pandy',
  'walker',
  'biped',
  'show',
  1.4,
  'square',
  'a round soft toy panda-cat: black and white, cat ears and a striped tail, big friendly eyes, wearing a small magenta backpack',
  { soft: 'a cute round panda kitten soft toy with a little pink backpack' },
);
add(
  'cakey',
  'fixed',
  'biped',
  'show',
  1.2,
  'square',
  'a tiny cupcake cat character: a white kitten face with pink frosting and sprinkles on top like hair, a blue cupcake-case body, little arms and legs, a big smile',
  { soft: 'a tiny smiling cupcake with a kitten face, pink frosting and sprinkles' },
);
add(
  'mercat',
  'fixed',
  'biped',
  'show',
  1.6,
  'bay',
  'a mermaid cat character: turquoise and pink cat upper body with long wavy hair, a shiny scaled mermaid tail, a shell necklace, sitting at the edge of a rock pool',
  { soft: 'a pretty turquoise cat with a mermaid tail and a shell necklace' },
);
add(
  'dj_catnip',
  'fixed',
  'biped',
  'show',
  1.6,
  'square',
  'a cool lavender-purple cat character in a sparkly pink hoodie and a visor, with headphones round his neck and a long stretchy tail, relaxed smile',
  { soft: 'a cool purple cat in a pink hoodie with headphones' },
);
add(
  'kitty_fairy',
  'fixed',
  'biped',
  'show',
  1.3,
  'square',
  'a tiny fairy cat character: pink kitten with see-through pink and green wings, a flower crown, a green petal dress and two blossom antennae, gentle smile',
  { soft: 'a tiny pink kitten fairy with wings, a flower crown and a petal dress' },
);

// ---------------------------------------------------------------- real family and friends: PEOPLE.md prompt descriptions, word for word
add('mum', 'walker', 'biped', 'person', 2.05, 'home', 'a friendly cartoon person');
add('dad', 'walker', 'biped', 'person', 2.1, 'home', 'a friendly cartoon person');
add('aunty', 'fixed', 'biped', 'person', 1.9, 'square', 'a friendly cartoon person', {
  sheetNote: 'the same look in every view',
});
add('granny', 'walker', 'biped', 'person', 1.95, 'square', 'a friendly cartoon person');
add('nanny', 'walker', 'biped', 'person', 1.95, 'square', 'a friendly cartoon person');
add('grandad', 'walker', 'biped', 'person', 2.05, 'square', 'a friendly cartoon person');
add('grandad_xmas', 'walker', 'biped', 'person', 2.05, 'square', 'a friendly cartoon person', { family: 'grandad' });
add('robin', 'walker', 'biped', 'person', 1.75, 'square', 'a friendly cartoon person');
add('sam', 'walker', 'biped', 'person', 1.7, 'square', 'a friendly cartoon person');
add('alex', 'walker', 'biped', 'person', 1.7, 'square', 'a friendly cartoon person');
// D69: the fourth classmate; the first classmate's model is the style reference so the class reads as one set
add('charlie', 'walker', 'biped', 'person', 1.7, 'square', 'a friendly cartoon person', {
  family: 'robin',
  sheetNote: 'the same look in every view',
});
add('teacher', 'walker', 'biped', 'person', 2, 'square', 'a friendly cartoon person');

// ---------------------------------------------------------------- Minecraft friends, animals and mobs
const blockMan =
  'in the style of a voxel block-building sandbox game: the whole body is made of rectangular boxes (cube head, box torso, box arms, box legs), pixel-art surface texture with big square pixels';
add(
  'villager_a',
  'speakingMob',
  'biped',
  'block',
  2,
  'plains',
  `a blocky villager ${blockMan}; a bald head with a very big long nose and one thick dark eyebrow, green eyes, a long brown robe, arms folded together in his sleeves`,
);
add(
  'villager_b',
  'speakingMob',
  'biped',
  'block',
  2,
  'plains',
  `a blocky farmer villager ${blockMan}; a big long nose and one thick dark eyebrow, a wide straw hat, a brown robe with a white apron, arms folded together in his sleeves`,
  { family: 'villager_a' },
);
add(
  'wandering_trader',
  'speakingMob',
  'biped',
  'block',
  2,
  'plains',
  `a blocky travelling trader ${blockMan}; a big long nose, a blue hooded robe with gold and red trim, arms folded together in his sleeves`,
  { family: 'villager_a' },
);
add(
  'golem',
  'speakingMob',
  'biped',
  'block',
  2.9,
  'plains',
  `a huge gentle blocky iron golem ${blockMan}; pale grey-cream metal body with green vines growing on it, very long arms hanging down, a small head with a long nose and red eyes, holding a red poppy flower`,
);
add(
  'snow_golem',
  'fixed',
  'biped',
  'block',
  1.9,
  'home',
  `a blocky snowman golem in the style of a voxel block-building sandbox game, made of cubes with pixel-art surface texture and big square pixels, no legs; two white snow blocks stacked for a body, stick arms, a carved pumpkin for a head with a friendly face: a wide happy carved smile and two round carved eyes, dark inside with no glow. Kind and funny, never scary`,
  {
    soft: 'a cute blocky snowman toy made of two white cube blocks, thin brown stick arms, an orange cube pumpkin head with a big friendly carved smile',
  },
);
add(
  'zombie',
  'hostile',
  'biped',
  'block',
  2,
  'mobs',
  `a blocky zombie monster ${blockMan}; green skin, dark square eyes, teal short-sleeved shirt, indigo trousers, both arms stretched straight out in front. Not scary: a little goofy`,
);
add(
  'skeleton',
  'hostile',
  'biped',
  'block',
  2,
  'mobs',
  `a blocky skeleton monster ${blockMan}; thin pale grey bone limbs and ribs, dark square eye sockets, holding a wooden bow. Not scary: a little goofy`,
);
add(
  'creeper',
  'hostile',
  'blob',
  'block',
  1.9,
  'mobs',
  'a tall green blocky creature in the style of a voxel block-building sandbox game: a tall box body with no arms, four short box feet, a cube head with a dark pixelated face (two square eyes and a frowning mouth shape below them), mottled light and dark green pixel-art surface texture with big square pixels. Not scary: curious and a bit shy',
);
add(
  'spider',
  'hostile',
  'spider',
  'block',
  1.1,
  'mobs',
  'a wide low blocky spider in the style of a voxel block-building sandbox game: dark grey-brown box body and head, eight box legs, a cluster of small red square eyes, pixel-art surface texture with big square pixels. Not scary: a little goofy',
  // it hops at her (mobs.ts aiHopper): the hop is its pounce
  { alias: { hop: 'attack' } },
);
add(
  'enderman',
  'hostile',
  'biped',
  'block',
  3,
  'mobs',
  `a very tall thin blocky creature ${blockMan}; all black with very long thin arms and legs, glowing purple eyes, a few purple sparkles around it, carrying a grass block. Shy, not scary`,
);
add(
  'spider_jockey',
  'boss',
  'spider',
  'block',
  2.6,
  'mobs',
  'a blocky skeleton riding on the back of a wide blocky spider, in the style of a voxel block-building sandbox game: the pale grey skeleton holds a bow, the dark spider has red square eyes and eight box legs, pixel-art surface texture with big square pixels. A bit silly, not scary',
);
add(
  'creeper_king',
  'boss',
  'blob',
  'block',
  4,
  'mobs',
  'a very big tall green blocky creature in the style of a voxel block-building sandbox game, like a giant king: a tall box body with no arms, four short box feet, a cube head with a dark pixelated worried face, a small golden crown on top, a red royal cape, mottled green pixel-art surface texture with big square pixels. Lonely and shy, not scary',
);
const blockPet =
  'in the style of a voxel block-building sandbox game, made of boxes with a pixel-art surface texture with big square pixels';
add(
  'chicken',
  'animal',
  'bird',
  'block',
  1,
  'animals',
  `a small white blocky chicken ${blockPet}: red comb and wattle, yellow beak and legs`,
);
add(
  'pig',
  'animal',
  'quad',
  'block',
  1.2,
  'animals',
  `a pink blocky farm pig ${blockPet}: box body, square snout, short legs`,
);
add(
  'cow',
  'animal',
  'quad',
  'block',
  1.5,
  'animals',
  `a blocky farm cow ${blockPet}: brown and white patches, small horns, a pale muzzle`,
);
add(
  'sheep',
  'animal',
  'quad',
  'block',
  1.3,
  'animals',
  `a fluffy white blocky sheep ${blockPet}: thick white wool block body, tan face and legs`,
);
add(
  'wolf',
  'animal',
  'quad',
  'block',
  1.2,
  'animals',
  `a friendly grey-white blocky wolf dog ${blockPet}: upright ears, bushy tail, a red collar`,
);
add(
  'cat',
  'animal',
  'quad',
  'block',
  1,
  'animals',
  `a small blocky ginger tabby cat ${blockPet}: orange with darker stripes, a white muzzle, green eyes`,
);
add(
  'llama',
  'animal',
  'quad',
  'block',
  1.8,
  'animals',
  `a cream blocky llama ${blockPet}: tall furry neck, small face, a blue and white patterned blanket on its back`,
);
add(
  'duck',
  'animal',
  'bird',
  'show',
  0.9,
  'animals',
  'a small friendly cartoon white duck with an orange beak and feet',
);

// ---------------------------------------------------------------- cameos, made last if there is time
add(
  'muffin',
  'fixed',
  'biped',
  'show',
  1.3,
  'heeler',
  'a tiny cartoon cream-white heeler toddler puppy standing on two legs, no clothes, block-shaped body, pale grey-blue pointed ears, a cream muzzle, very cheeky grin',
  { family: 'bluey', cameo: true },
);
add(
  'socks',
  'fixed',
  'biped',
  'show',
  1.1,
  'heeler',
  'the tiniest cartoon heeler baby puppy, plain mid-blue fur like her older cousin, no clothes, block-shaped body, darker blue pointed ears, a cream muzzle, white paws',
  { family: 'bluey', cameo: true },
);
add(
  'suzy_sheep',
  'fixed',
  'biped',
  'show',
  1.6,
  'peppa',
  'a little white sheep girl in a pink dress, simple preschool picture-book cartoon, with black shoes',
  { family: 'peppa', cameo: true },
);
add(
  'grandpa_pig',
  'fixed',
  'biped',
  'show',
  2.1,
  'peppa',
  'a jolly grandfather pig in an indigo shirt and a navy sailing cap with a small white anchor badge, round glasses, simple preschool picture-book cartoon, pink',
  { family: 'peppa', cameo: true },
);
add(
  'granny_pig',
  'fixed',
  'biped',
  'show',
  2,
  'peppa',
  'a kind grandmother pig in a plain magenta dress, round glasses, simple preschool picture-book cartoon, pink',
  { family: 'peppa', cameo: true },
);
add(
  'amma',
  'fixed',
  'biped',
  'toy',
  1.4,
  'bing',
  'a small light-blue stuffed elephant soft toy carer, plush finish, a short trunk, simple dot eyes and a gentle smile',
  { family: 'flop', cameo: true },
);
add(
  'padget',
  'fixed',
  'biped',
  'toy',
  1.4,
  'bing',
  'a short green stuffed soft toy carer who keeps the corner shop, plush finish, simple dot eyes and a cheerful smile',
  { family: 'flop', cameo: true },
);
add(
  'my_melody',
  'fixed',
  'biped',
  'kawaii',
  1.5,
  'square',
  'a cute kawaii white rabbit character wearing a pink hood that covers her ears, with a small flower on the hood, dot eyes and a yellow nose. Thick dark outline',
  { family: 'hello_kitty', cameo: true },
);
add(
  'baby_box',
  'fixed',
  'biped',
  'show',
  1.1,
  'square',
  'a tiny cardboard box cat: pink and peach box body with tape details, kitten ears and a sweet smile',
  { cameo: true },
);
add(
  'catrat',
  'fixed',
  'biped',
  'show',
  1.3,
  'square',
  'a sly little blue cat with a long thin tail, dark and light blue patches and a cheeky grin',
  { cameo: true },
);
add(
  'pillow_cat',
  'fixed',
  'biped',
  'show',
  1.3,
  'square',
  'a sleepy cat shaped like a soft patchwork pillow, many colours, with ears and a plump tail',
  { cameo: true },
);

// ---------------------------------------------------------------- the secret show (package 70): three pop singers who
// hunt shadows with song, in the island's storybook look (Amelia's model as the style reference). No names here.
const SINGER_NOTE =
  'she is one of three singer friends in matching stage clothes: black with gold trim and her own colour; the hair keeps its style and colour in every view';
add(
  'rumi',
  'walker',
  'biped',
  'person',
  1.9,
  'huntrix',
  'Confident young woman pop singer, very long violet-purple hair in one thick braid that hangs down to her waist, light skin, golden eyes, a short black stage jacket with gold trim over a purple top, black trousers, black boots, holding a small gold microphone',
  {
    family: 'amelia',
    soft: 'a young woman singer with a long purple braid, a black and gold stage jacket and a small gold microphone',
    sheetNote: SINGER_NOTE,
  },
);
add(
  'mira',
  'walker',
  'biped',
  'person',
  2,
  'huntrix',
  'Tall cool young woman pop singer, long dark red hair in a high ponytail, light skin, a calm half smile, a black stage top with gold trim and a deep red sash, long black trousers, black boots',
  {
    family: 'amelia',
    soft: 'a tall young woman singer with a long dark red ponytail in black and red stage clothes',
    sheetNote: SINGER_NOTE,
  },
);
add(
  'zoey',
  'walker',
  'biped',
  'person',
  1.8,
  'huntrix',
  'Bubbly young woman pop singer, shorter than her friends, black hair in two round space buns with short loose strands, light skin, a big grin, a black cropped stage jacket with gold trim over a teal top, black shorts over leggings, white trainers',
  {
    family: 'amelia',
    soft: 'a cheerful young woman singer with black hair in two buns, a black and teal stage outfit and white trainers',
    sheetNote: SINGER_NOTE,
  },
);

export const cast = c;
