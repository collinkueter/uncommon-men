import { normalizeName } from "./ranking";
import type { Participant } from "./types";

// Teammates often add someone by first name or a nickname ("Roger", "Mike")
// before that person ever opens the app. These groups let "Michael Smith"
// find the "Mike" someone put on a team.
const nicknameGroups = [
  ["michael", "mike", "mikey", "mick"],
  ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["william", "will", "bill", "billy", "liam"],
  ["richard", "rich", "rick", "ricky", "dick"],
  ["james", "jim", "jimmy", "jamie"],
  ["john", "jon", "johnny", "jack"],
  ["jonathan", "jon", "jonny", "nathan"],
  ["joseph", "joe", "joey"],
  ["thomas", "tom", "tommy"],
  ["christopher", "chris", "topher"],
  ["daniel", "dan", "danny"],
  ["matthew", "matt"],
  ["anthony", "tony"],
  ["andrew", "andy", "drew"],
  ["nicholas", "nick", "nicky"],
  ["benjamin", "ben", "benny"],
  ["samuel", "sam", "sammy"],
  ["alexander", "alex", "xander"],
  ["joshua", "josh"],
  ["zachary", "zach", "zack"],
  ["timothy", "tim", "timmy"],
  ["steven", "stephen", "steve"],
  ["edward", "ed", "eddie", "ted"],
  ["charles", "charlie", "chuck"],
  ["david", "dave", "davey"],
  ["gregory", "greg"],
  ["jeffrey", "jeff"],
  ["kenneth", "ken", "kenny"],
  ["patrick", "pat"],
  ["peter", "pete"],
  ["ronald", "ron", "ronnie"],
  ["donald", "don", "donnie"],
  ["douglas", "doug"],
  ["gerald", "gerry", "jerry"],
  ["lawrence", "larry"],
  ["raymond", "ray"],
  ["theodore", "ted", "teddy", "theo"],
  ["frederick", "fred", "freddie"],
  ["jacob", "jake"],
  ["nathaniel", "nate", "nathan"],
];
const nicknames = new Map<string, Set<string>>();
for (const group of nicknameGroups)
  for (const name of group) {
    const set = nicknames.get(name) ?? new Set<string>();
    for (const other of group) set.add(other);
    nicknames.set(name, set);
  }

function sameFirstName(left: string, right: string) {
  return left === right || Boolean(nicknames.get(left)?.has(right));
}

function editDistance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[right.length];
}

const tokensOf = (name: string) => normalizeName(name).replace(/[.,'’-]/g, "").split(" ").filter(Boolean);

// How likely it is that two names belong to the same person, from 0 (no
// resemblance) to 100 (identical once normalized).
export function nameSimilarity(typed: string, existing: string): number {
  const a = tokensOf(typed);
  const b = tokensOf(existing);
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 100;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // "Roger" vs "Roger Smith", "Mike" vs "Michael Smith", "Roger S" vs "Roger Smith".
  if (sameFirstName(short[0], long[0])) {
    const rest = short.slice(1);
    if (!rest.length) return short[0] === long[0] ? 85 : 75;
    if (rest.every((token, index) => long[index + 1]?.startsWith(token) || token.startsWith(long[index + 1] ?? "\0")))
      return short[0] === long[0] ? 90 : 80;
    return 0;
  }
  // Typos: "Rodger Smith" vs "Roger Smith", "Jon Smith" vs "Joan Smith".
  // Short names differ by one letter too often ("Ben"/"Ken") to count as typos.
  const length = Math.max(a.join(" ").length, b.join(" ").length);
  if (length >= 5 && editDistance(a.join(" "), b.join(" ")) <= (length >= 8 ? 2 : 1)) return 70;
  if (short.length === 1 && short[0].length >= 4 && editDistance(short[0], long[0]) <= 1) return 60;
  // Initials: "R Smith" vs "Roger Smith".
  if (
    a.length === b.length && a.length > 1 &&
    a.slice(1).join(" ") === b.slice(1).join(" ") &&
    (a[0].length === 1 || b[0].length === 1) && a[0][0] === b[0][0]
  )
    return 65;
  return 0;
}

export function findSimilarParticipants(
  name: string,
  participants: Participant[],
  limit = 5,
): Participant[] {
  return participants
    .map((participant) => ({ participant, score: nameSimilarity(name, participant.name) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.participant.name.localeCompare(right.participant.name))
    .slice(0, limit)
    .map((item) => item.participant);
}
