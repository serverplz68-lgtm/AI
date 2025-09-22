#!/bin/bash

while true; do
  clear
  echo "==== AI Code Helper ===="
  echo "1) Code Test"
  echo "2) Check Errors"
  echo "3) Make Website (mkc)"
  echo "4) Exit"
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
      echo -n "Enter project name: "
      read name
      mkdir -p "$name"
      cat > "$name/index.html" <<EOF
<!DOCTYPE html>
<html>
<head>
  <title>My AI Website</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <h1>Hello! 🚀</h1>
  <p>This website was created by my AI helper.</p>
</body>
</html>
EOF
      cat > "$name/style.css" <<EOF
body { font-family: Arial; background:#f0f0f0; text-align:center; }
EOF
      cat > "$name/script.js" <<EOF
console.log("Website ready 🚀");
EOF
      echo "✅ Website created in folder: $name"
      ;;
    4)
      echo "Bye 👋"
      exit 0
      ;;
    *)
      echo "Invalid option. Try again."
      ;;
  esac
  echo -e "\nPress Enter to continue..."
  read
done
