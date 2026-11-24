// Shelves are Open Library subject queries. Open Library's subject tags are noisy, so the
// non-fiction ones combine several specific subjects and leave out anything tagged as fiction.
const nf = s => `(${s.map(x => `subject:"${x}"`).join(' OR ')}) -subject:fiction -subject:"juvenile fiction"`;

export const NONFICTION = [
  { key: 'self-help', label: 'Self-help', title: 'Self-help and psychology', q: nf(['Psychology', 'Self-help techniques', 'Success', 'Happiness']) },
  { key: 'money', label: 'Money and business', title: 'Money and business', q: nf(['Personal finance', 'Finance, Personal', 'Investments', 'Success in business', 'Management', 'Entrepreneurship']) },
  { key: 'programming', label: 'Programming', title: 'Programming', q: nf(['Computer programming', 'Programming languages (Electronic computers)', 'Python (Computer program language)', 'JavaScript (Computer program language)', 'Java (Computer program language)']) },
  { key: 'engineering', label: 'Engineering', title: 'Engineering and computer science', q: nf(['Civil engineering', 'Mechanical engineering', 'Electrical engineering', 'Electronics', 'Engineering design', 'Computer science', 'Software engineering']) },
  { key: 'science', label: 'Science', title: 'Popular science', q: nf(['Physics', 'Astronomy', 'Cosmology', 'Evolution (Biology)', 'Neurosciences', 'Chemistry']) },
  { key: 'maths', label: 'Maths', title: 'Maths and statistics', q: nf(['Calculus', 'Algebra', 'Statistics', 'Geometry', 'Probabilities', 'Mathematical recreations']) },
  { key: 'textbooks', label: 'Textbooks', title: 'Free university textbooks', sub: 'Complete, peer-reviewed and openly licensed, from OpenStax', textbooks: true },
  { key: 'lives', label: 'Biography', title: 'Biographies and memoirs', q: nf(['Biography', 'Autobiography']) },
  { key: 'food', label: 'Food and cooking', title: 'Food and cooking', q: nf(['Cooking', 'Baking']) },
  { key: 'health', label: 'Health', title: 'Health and fitness', q: nf(['Nutrition', 'Physical fitness', 'Reducing diets']) },
  { key: 'philosophy', label: 'Philosophy', title: 'Philosophy', q: 'subject:"Philosophy"' },
  { key: 'history', label: 'History', title: 'History', q: nf(['World history', 'History, Modern', 'Civilization']) },
];

export const FICTION = [
  { key: 'love', label: 'Love stories', title: 'Love stories', q: 'subject:"Love stories"' },
  { key: 'detective', label: 'Detective stories', title: 'Detective stories', q: 'subject:"Detective and mystery stories"' },
  { key: 'horror', label: 'Ghosts and horror', title: 'Ghosts and horror', q: '(subject:"Ghost stories" OR subject:"Horror tales")' },
  { key: 'scifi', label: 'Science fiction', title: 'Science fiction', q: 'subject:"Science fiction"' },
  { key: 'adventure', label: 'Adventure', title: 'Adventure', q: 'subject:"Adventure stories"' },
  { key: 'sea', label: 'At sea', title: 'At sea', q: 'subject:"Sea stories"' },
  { key: 'young', label: 'Young readers', title: 'Young readers', q: 'subject:"Children\'s stories"' },
  { key: 'fairy', label: 'Fairy tales', title: 'Fairy tales and fables', q: '(subject:"Fairy tales" OR subject:"Fables")' },
  { key: 'funny', label: 'Funny books', title: 'Funny books', q: 'subject:"Humorous stories"' },
  { key: 'short', label: 'Short stories', title: 'Short stories', q: 'subject:"Short stories"' },
  { key: 'poetry', label: 'Poetry', title: 'Poetry', q: 'subject:"Poetry"' },
  { key: 'plays', label: 'Plays', title: 'Plays', q: 'subject:"Drama"' },
  { key: 'travel', label: 'Travel', title: 'Travel', q: 'subject:"Voyages and travels"' },
];

export const SHELVES = [...NONFICTION, ...FICTION];
export const shelfByKey = k => SHELVES.find(s => s.key === k);
