#!/bin/bash

# GitHub raw link for self-update
REPO_URL="https://raw.githubusercontent.com/serverplz68-lgtm/AI/main/Ai.sh"

while true; do
  clear
  echo "==== AI Shell Helper ===="
  echo "1) Code Test (Python)"
  echo "2) Check Errors (Python)"
  echo "3) Make Website (AI Website Generator)"
  echo "4) Delete File/Folder"
  echo "5) Update (Get latest AI file)"
  echo "6) AI (future features)"
  echo "7) Exit"
  echo -n "Choose option: "
  read choice

  case $choice in
    1)
      echo -n "Enter Python file path to run: "
      read file
      if python3 "$file"; then
        echo "✅ Code ran successfully!"
      else
        echo "❌ Code has errors!"
      fi
      ;;
    2)
      echo -n "Enter Python file path to check: "
      read file
      if python3 -m py_compile "$file" 2>error.log; then
        echo "✅ No syntax errors found."
      else
        echo "❌ Errors found:"
        cat error.log
      fi
      ;;
    3)
      echo -n "Enter website project name: "
      read name
      echo -n "Enter website type (e.g. Portfolio, Blog, Shop, Food, School): "
      read type
      mkdir -p "$name"
      
      case $type in
        [Pp]ortfolio)
          TITLE="My Portfolio"
          BODY="<h1>Welcome to My Portfolio 🚀</h1>
          <p>Here you can find my projects, skills, and contact info.</p>"
          ;;
        [Bb]log)
          TITLE="My Blog"
          BODY="<h1>Welcome to My Blog ✍️</h1>
          <p>Sharing thoughts, tutorials, and stories.</p>"
          ;;
        [Ss]hop)
          TITLE="My Shop"
          BODY="<h1>Welcome to My Online Shop 🛒</h1>
          <p>Browse products and place orders easily.</p>"
          ;;
        [Ff]ood)
          TITLE="Food Delivery"
          BODY="<h1>Delicious Food Delivered 🍔</h1>
          <p>Order your favorite meals with fast home delivery.</p>"
          ;;
        [Ss]chool)
          TITLE="School Website"
          BODY="<h1>Welcome to Our School 🏫</h1>
          <p>Learn, grow, and succeed with us.</p>"
          ;;
        *)
          TITLE="$type Website"
          BODY="<h1>Hello from $type 🚀</h1>
          <p>This is a $type website created by AI Shell Helper.</p>"
          ;;
      esac

      cat > "$name/index.html" <<EOF
<!DOCTYPE html>
<html>
<head>
  <title>$TITLE</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  $BODY
</body>
</html>
EOF

      cat > "$name/style.css" <<EOF
body { font-family: Arial; background:#f9f9f9; text-align:center; padding:20px; }
h1 { color:#333; }
p { color:#555; }
EOF

      cat > "$name/script.js" <<EOF
console.log("Website '$TITLE' generated successfully 🚀");
EOF

      echo "✅ $type website created in folder: $name"
      ;;
    4)
      echo -n "Enter file/folder name to delete: "
      read target
      if [ -e "$target" ]; then
        rm -rf "$target"
        echo "🗑 Deleted: $target"
      else
        echo "⚠️ File/Folder not found!"
      fi
      ;;
    5)
      echo "🔄 Updating Ai.sh from GitHub..."
      curl -s -o "$0" "$REPO_URL"
      echo "✅ Update complete! Restart script."
      exit 0
      ;;
    6)
      echo "🤖 AI features coming soon..."
      ;;
    7)
      echo "Bye 👋"
      exit 0
      ;;
    *)
      echo "Invalid option. Try again!"
      ;;
  esac
  echo -e "\nPress Enter to continue..."
  read
done
