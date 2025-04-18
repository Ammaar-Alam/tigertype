#!/usr/bin/env python3
"""
process_evals.py  – extracts "typing‑game" snippets from Princeton course reviews
and saves progress continuously so you can stop / restart at any time.

Files it maintains (in the same directory):

  • raw_evaluations.json       – remaining comments still to process
  • processed_snippets.json    – all extracted / validated snippets so far
"""
# [AI DISCLAIMER: AI WAS USED TO HELP DEBUG / POLISH THIS SCRIPT]

import json, os, re, signal, sys, time
from pathlib import Path
from openai import OpenAI, RateLimitError, APIError
from dotenv import load_dotenv

# ── CONFIGURATION ──────────────────────────────────────────────────────────────
RAW_DATA_FILE           = "raw_evaluations.json"
PROCESSED_SNIPPETS_FILE = "processed_snippets.json"

DEFAULT_SOURCE    = "Princeton Course Reviews"
DEFAULT_CATEGORY  = "course-reviews"

MODEL_ID        = "gpt-4.1" # can't wait to try out new model hehe
MAX_RETRIES     = 5     # increased from 3 to help w rate limiting
INITIAL_DELAY   = 1     # seconds between retry back‑off
FLUSH_INTERVAL  = 1     # write files after every N comments (set 1 = every)

TMP_SUFFIX        = ".tmp"  # for atomic writes

# ── ENV / OPENAI SETUP ─────────────────────────────────────────────────────────
script_dir  = Path(__file__).resolve().parent

# load .env (either at project root or script directory)
dotenv_path = (script_dir / ".." / ".." / ".env").resolve()
if not dotenv_path.exists():
    dotenv_path = script_dir / ".env"
if dotenv_path.exists():
    print(f"Loading environment variables from: {dotenv_path}")
    load_dotenv(dotenv_path)
else:
    print("⚠️  .env not found – relying on shell env vars")

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    print("❌  OPENAI_API_KEY not set.")
    sys.exit(1)

client = OpenAI(api_key=api_key)

# ── SMALL UTILS ───────────────────────────────────────────────────────────────
def atomic_write(obj, path: Path):
    """Safely dump JSON → path by writing to *.tmp then os.replace()."""
    tmp = path.with_suffix(path.suffix + TMP_SUFFIX)
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)   # atomic on POSIX

def load_json(path: Path, default):
    if path.exists():
        try:
            with path.open(encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️  Could not load {path}: {e}")
    return default

def word_count(txt): return len(txt.split())
def char_count(txt): return len(txt)

# ── AI CALL ────────────────────────────────────────────────────────────────────
def call_ai_to_extract_snippets(comment_text):
    """
    Calls the OpenAI API to analyze the comment, extract engaging snippets,
    and assign a difficulty rating (1‑3) to each.
    Returns a list of dicts, e.g. [{'text': 'snippet', 'difficulty': 2}].
    """
    # quick sanity filter
    if len(comment_text) < 20 or re.match(r"^[0-9.]+$|^N/A$|^n/a$", comment_text.strip()):
        return []

    # ——— huge prompt with examples ———
    example_snippets = [
        "This would be a great course if it was not taught by Joe Scanlan. Alas, it is taught by him. Do not take this class if you are uncomfortable having a racist professor.",
        "This is the type of course that 10/10 dentists would recommend. You got better service on Ed than you would get at Verizon Wireless. Moretti/Li/Gabai had better offensive chemistry than Curry/Thompson/Durant.",
        "This class definitely put me in my lowest lows, a lot of sobbing in JRR bathrooms and I considered dropping/PDFing it multiple times. In fact, countless people did end up dropping it. Everyday I questioned why I didn't follow suit.",
        "This was when mental illness took a hold of me. Each assignment after was a similar fight for my life. I still do not think I know what a raytracer is or rasterizer despite spending a decade coding them. The only thing I knew was pain. I wanted to explore the intersection between visual arts and programming, and the only thing I need to explore now is therapy.",
        "The assignment states that \"In this assignment you will create a simple 3D modeling program,\" yet it is nothing but \"simple\". It is perhaps \"simple\" to Alan Turing or an extremely experienced programmer but I am not a natural-born computer scientist. I did not come out of the womb coding JavaScript. My first words as a child were \"mom\", and not \"Hello World\" . So why and who thought it was brilliant to exponentially increase the difficulty to this significant level?",
        "After five weeks of partaking in this course, I had to contact my psychiatric provider to prescribe me anti-depressants. This is because this course perpetuated my mental illness, with each assignment spurring new bouts of depression. Whenever I think I reached a new low, this course gave me a shovel and commanded me to dig deeper.",
        "However, one heavenly force shielded me from the pain: Claire Gmachl. A goddess among us. Mother Teresa, or perhaps even God, reincarnated into a Princetonian.",
        "Dr. Martinez mentioned she gets motion sickness very easily, so it's a miracle she can still teach this course given how fast we move between concepts and how quickly each exam comes up.",
        "On the first day of lecture, I walked into McCosh 10, opened my laptop, and started playing coolmathgames.com. Let me tell you that when Vreeland started speaking, I had to PUT DOWN Papa's Pizzeria and listen to the eloquent stream of creativity this man constructed.",
        "Like, if you want to learn how to suffer the slings and arrows of outrageous fortune, this is your class. If you want to bike home as the birdies sing every Friday dawn, this is your class. If you want to cry while reading the St. Crispin's day speech as the 9AM classes start to trickle in, this class is for you.",
        "I have been giving this class my all. Body and soul. Sinew and stone. Of my own flesh have I made an offering. 80% of this term's allotted nightmares/stress dreams. Easily 70% of my homework time. But, I mean, now that I'm at the end, I feel kinda... forged. I am hot steel, about to plunge into the ice bucket of winter break. It has made a man out of me.",
        "This class was the definition of masochism. As an alternative, try (1) playing a Knife Game with a cleaver, (2) chewing cactus, (3) drinking boiling water, (4) ordering \"Indian Spicy\" at a local Indian joint, (5) waterboarding yourself in the Public Policy school fountain, (6) driving with your feet across a mine field, (7) juggling hatchets whose handles were dipped in flaming oil, (9) walking barefoot on needles, (10) force‑pulling your teeth out with pliers and no anesthesia, (11) playing Marco Polo with a bear, (12) running through campus naked in the middle of winter, or (13) wiping your hand across a splintered board repeatedly.",
        "Imagine this: you get a toddler, give them a book on differential equations that has 70% of its pages ripped, and ask them to find the wave function of a Hydrogen atom using Schrodinger's equation (without any guidance). This is EXACTLY how the assignments felt. They are torture devices intended for you to end up questioning your entire education and supposed intelligence.",
        "I watched in horror as he poured his heart and soul into the code, ignoring the warnings and errors that flashed on the screen. As the hours ticked by, Max's energy began to flag. His paws moved slower, his eyes growing dimmer with each passing minute. I knew that he was pushing himself too far, but I couldn't stop him. The code grew more complex, a twisted labyrinth of logic and mathematics.",
        "Max, the reincarnation of Helen Keller, had pushed the boundaries of coding too far. He had tried to defy the laws of computer science, and it had cost him his life. As I held Max's lifeless body, I knew that I would never forget the lessons he had taught me. He had shown me the power of coding, the limitless possibilities of the digital realm. And he had paid the ultimate price for his ambition. I buried Max in the backyard, surrounded by the code that had consumed him.",
        "DO NOT TAKE THIS CLASS. RUN. GET OUT BEFORE IT'S TOO LATE! This class is the worst class I've ever taken. It even makes writing sem look good. If you think you might be interested in systems, don't take this course.",
        "If you need to fulfill your systems requirement, don't take this course. If you're just looking for another cos class, don't take this course. If you're standing on the edge of a cliff and can either jump or take this course, I'd tell you to jump. STAY AWAY.",
        "Its like he understands all the potential impediments to understanding math and has a solution to them.",
        "We kind of acted like they didn't have anything else going on in their lives during the final project.",
        "If you don't believe in God, then I would start quickly, because in that lab there is basically nothing you can do besides pray.",
        "Integrated Science Curriculum? More like I Scream and Cry (everyday, everynight over this class).",
        "Verilog, which is an awful language full of strange idiosyncracies that destroy your code for no reason.",
        "If that isn't enough, literal billionaires come to speak to this class.",
        "So procrastination is actually a good option.",
    ]
    examples_text = "\n\nHere are some examples of the *type* of snippets I want you to extract:\n"
    for i, ex in enumerate(example_snippets):
        examples_text += f"{i+1}. \"{ex}\"\n"

    # im no prompt engineer by any means but i think i cooked
    system_prompt = (
        "You are an *EXTREMELY SELECTIVE* assistant tasked with identifying ONLY the MOST engaging, funny, or uniquely phrased snippets from Princeton course reviews, suitable for a typing game."
        "Your primary goal is QUALITY over quantity. Be very critical: it is better to return NOTHING than to return a bland snippet or something that would not be fun to type."
        "The only users of the app are Princeton students so consider that the snippets, on top of being fun to type, should contain information useful for students deciding whether to take a course."
        "Focus on extracting short, self‑contained, interesting, humorous, witty, strongly opinionated, or insightful phrases/sentences (15‑150 words)."
        "AVOID generic advice, mundane praise/criticism, boilerplate, or personal info unless the *wording* itself is gold. More generic advice is only good if it's phrased in a way that's fun to type, or if it is useful information for the course."
        "For EACH snippet include a difficulty rating: 1 (easy), 2 (medium), 3 (hard). "
        "***Return an empty list [] if nothing meets the bar.*** "
        f"{examples_text}"
        "\nNow analyze the following review:"
        "\n\n[REVIEW START]\n{review}\n[REVIEW END]\n\n"
        "Output ONLY a JSON list, e.g. "
        "[{{\"text\":\"…\",\"difficulty\":2}}, {{\"text\":\"…\",\"difficulty\":1}}] or []."
    ).replace("{review}", "{review}")  # keep literal placeholder for f‑string below

    retries = 0
    delay   = INITIAL_DELAY
    while retries < MAX_RETRIES:
        try:
            prompt = system_prompt.format(review=comment_text)
            response = client.chat.completions.create(
                model           = MODEL_ID,
                messages        = [
                    {"role": "system", "content": prompt},
                ],
                temperature     = 0.8,
                max_tokens      = 1024,
                response_format = {"type": "json_object"}
            )

            raw_json = response.choices[0].message.content
            # Debug: show the raw AI response before parsing
            print(f"🔹 Raw AI response: {raw_json}")
            try:
                parsed = json.loads(raw_json)
            except json.JSONDecodeError:
                print("⚠️  JSON decode failed – returning []")
                return []

            # Accept either list of objects or dict with a list inside
            if isinstance(parsed, dict):
                found_list = False
                # common wrapper keys
                for k in ("snippets", "list", "results", "data"):
                    if k in parsed and isinstance(parsed[k], list):
                        parsed = parsed[k]
                        found_list = True
                        break
                # If it's a dict but not a wrapper, check if it's a single snippet
                if not found_list and "text" in parsed and "difficulty" in parsed:
                    print("🔹 AI returned a single snippet object, wrapping in list.")
                    parsed = [parsed]

            # Ensure we have a list before proceeding
            if not isinstance(parsed, list):
                print(f"🔹 Parsed AI output is not a list: {parsed!r}")
                print("⚠️  Unexpected AI response format – skipping")
                return []

            cleaned = []
            for item in parsed:
                if not isinstance(item, dict):
                    print(f"⚠️  Skipping non-dict item in list: {item!r}")
                    continue
                txt  = re.sub(r"\s+", " ", str(item.get("text", ""))).strip()
                diff = int(item.get("difficulty", 0)) if str(item.get("difficulty", "")).isdigit() else None
                if txt and diff in (1, 2, 3):
                    cleaned.append({"text": txt, "difficulty": diff})
            return cleaned

        except RateLimitError:
            retries += 1
            print(f"🌐 Rate‑limit, retrying in {delay}s… ({retries}/{MAX_RETRIES})")
            time.sleep(delay)
            delay *= 2
        except APIError as e:
            print(f"❌ OpenAI API error: {e}")
            return []
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            return []

    print("❌ Reached max retries with OpenAI.")
    return []

# ── STATE LOAD ────────────────────────────────────────────────────────────────
raw_path       = script_dir / RAW_DATA_FILE
processed_path = script_dir / PROCESSED_SNIPPETS_FILE

raw_evals      = load_json(raw_path, [])
processed_snip = load_json(processed_path, [])

print(f"🔹 Loaded {len(raw_evals)} pending comments")
print(f"🔹 Loaded {len(processed_snip)} snippets already processed")

# ── graceful Ctrl‑C ───────────────────────────────────────────────────────────
interrupted = False
def _handle_sigint(sig, frame):
    global interrupted
    interrupted = True
    print("\n⚠️  Ctrl‑C detected – finishing current comment then saving…",
          file=sys.stderr)
signal.signal(signal.SIGINT, _handle_sigint)

# ── MAIN LOOP ─────────────────────────────────────────────────────────────────
start_time = time.perf_counter()
for idx, comment in enumerate(raw_evals[:]):          # iterate over *copy*
    if interrupted:
        break

    comment_text = comment.get("comment_text", "").strip()
    if not comment_text:
        raw_evals.remove(comment)
        continue

    cid  = comment.get("course_id", "???")
    term = comment.get("term",      "???")
    print(f"\n[{idx+1}/{len(raw_evals)}] Course {cid} ({term}) – extracting…")

    snippets = call_ai_to_extract_snippets(comment_text)
    print(f"    → {len(snippets)} snippet(s)")

    for snip in snippets:
        txt  = re.sub(r"\s+", " ", snip["text"]).strip()
        diff = snip["difficulty"]
        processed_snip.append({
            "text"               : txt,
            "source"             : DEFAULT_SOURCE,
            "category"           : DEFAULT_CATEGORY,
            "difficulty"         : diff,
            "word_count"         : word_count(txt),
            "character_count"    : char_count(txt),
            "is_princeton_themed": True,
            "original_url"       : comment.get("evaluation_url"),
            "original_course_id" : cid,
            "original_term_id"   : term,
            "course_name"        : comment.get("course_name")   # may be None
        })

    # remove comment so we don't revisit
    raw_evals.remove(comment)

    # flush every FLUSH_INTERVAL comments
    if (idx + 1) % FLUSH_INTERVAL == 0:
        atomic_write(raw_evals,   raw_path)
        atomic_write(processed_snip, processed_path)
        print("    💾 progress saved")

    time.sleep(1)          # polite delay for OpenAI

# ── FINAL SAVE ────────────────────────────────────────────────────────────────
atomic_write(raw_evals,   raw_path)
atomic_write(processed_snip, processed_path)

elapsed = time.perf_counter() - start_time
print(f"\n✅ Done. Remaining comments: {len(raw_evals)}  |  "
      f"total snippets: {len(processed_snip)}  |  runtime: {elapsed:0.1f}s")
